import type { TickContext } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import type { DiplomaticPlayId, PolityId, ProvinceId, HoldingId } from '../types/ids'
import type {
  DiplomaticPlay,
  DiplomaticPlayStatus,
  TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'
import type { EventEntityRef, EventMessageParams } from '../types/event'
import { entityRef, nameParam } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { adjustProvincePopUnrestByClass, adjustProvincePopUnrest } from '../mutations/popMutations'
import { disbandRebelPolity, type RebelLeaderAftermath } from '../mutations/worldStructureMutations'
import {
  applyLandContractTransferGoal,
  adjustLandContractTaxRate,
  eliminateContractFromChain,
} from '../mutations/landContractMutations'
import { getProvincePops } from '../selectors/popSelectors'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import {
  getProvinceTerminalPolityId,
  getProvinceDevelopmentFromHoldings,
  getHoldingLandContractChain,
} from '../selectors/landContractSelectors'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { calcGeneralWarPowerModifier } from '../selectors/personAbilityEffects'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { randomFloat } from '../rng/rng'
import { createLogger } from '../debug/logger'

// v0.18 Stage B/C/D §10 / §11 / §13
// DiplomaticPlaySystem: active な DiplomaticPlay を毎月進行させる。
//
// 役割:
//   - active Play の acceptanceScore を計算し、progress / tension を更新する
//   - progress >= settlementThreshold → settled (kind ごとの settlement 適用)
//   - tension  >= escalationThreshold → 'escalated' に設定 (DIPLOMATIC_PLAY_ESCALATED 発火)
//                                       本 system では status だけ変更、後段の
//                                       ConflictResolutionSystem (§13) が同 tick 中に
//                                       'resolved_by_conflict' に置換する
//   - deadline 到達 → progress > tension なら settled、tension > progress なら escalated、
//                     それ以外 failed
//
// 'escalated' は active 系 status (§10.2)。次 phase で resolve され terminal になる。

export function runDiplomaticPlaySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'active') continue
    if (play.kind === 'revolt_negotiation') {
      currentCtx = progressRevoltNegotiation(currentCtx, play)
    } else if (play.kind === 'land_claim') {
      currentCtx = progressLandClaim(currentCtx, play)
    } else if (play.kind === 'contract_tax_revision') {
      currentCtx = progressContractTaxRevision(currentCtx, play)
    }
  }

  // Phase 2: Ensure delegates are valid for active plays (spec §10)
  for (const playIdStr of Object.keys(currentCtx.state.diplomaticPlays).sort()) {
    const play = currentCtx.state.diplomaticPlays[playIdStr as DiplomaticPlayId]
    if (!play) continue
    if (play.status !== 'active') continue
    currentCtx = ensureDelegates(currentCtx, play)
  }

  return currentCtx
}

export function cancelOrphanedPlays(ctx: TickContext): TickContext {
  let nextPlays: Record<DiplomaticPlayId, DiplomaticPlay> | undefined
  for (const [idStr, play] of Object.entries(ctx.state.diplomaticPlays)) {
    if (!play || play.status !== 'active') continue

    let shouldCancel = false
    if (play.issue) {
      if (play.issue.kind === 'contract_tax_revision') {
        if (!ctx.state.landContracts[play.issue.landContractId]) shouldCancel = true
      }
      if (play.issue.kind === 'land_claim') {
        if (!ctx.state.holdings[play.issue.holdingId]) shouldCancel = true
      }
    } else {
      const d = play.primaryDemand
      if (d.kind === 'change_contract_tax_rate') {
        if (!ctx.state.landContracts[d.landContractId]) shouldCancel = true
      }
      if (d.kind === 'transfer_land_contract') {
        if (!ctx.state.holdings[d.holdingId]) shouldCancel = true
      }
    }

    if (shouldCancel) {
      if (!nextPlays) nextPlays = { ...ctx.state.diplomaticPlays }
      nextPlays[idStr as DiplomaticPlayId] = { ...play, status: 'cancelled' }
    }
  }
  if (!nextPlays) return ctx
  return { ...ctx, state: { ...ctx.state, diplomaticPlays: nextPlays } }
}

function isDeadlineReached(state: { absoluteWeek: number }, play: DiplomaticPlay): boolean {
  return state.absoluteWeek >= play.deadlineWeek
}

// ─── revolt_negotiation 進行 (Stage B、escalation 経路は Stage D で ConflictResolution に移譲) ───

function progressRevoltNegotiation(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.primaryDemand.kind !== 'revolt_concession') return ctx

  const demand = play.primaryDemand
  const provinceId = demand.provinceId
  const popClass = demand.popClass
  if (play.target.kind !== 'polity') return ctx
  const targetPolityId = play.target.id
  if (play.initiator.kind !== 'polity') return ctx
  const rebelPolityId = play.initiator.id

  const targetPolity = state.polities[targetPolityId]
  const rebelPolity = state.polities[rebelPolityId]
  if (!targetPolity || !targetPolity.active || !rebelPolity || !rebelPolity.active) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // Get POP stats for the rebel class (aggregated across Holdings)
  const pops = getProvincePops(state, provinceId).filter((p) => p.class === popClass)
  const totalSize = pops.reduce((s, p) => s + p.size, 0)
  const averageUnrest =
    totalSize > 0 ? pops.reduce((s, p) => s + p.unrest * p.size, 0) / totalSize : 0

  if (totalSize === 0) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // §10.3.1 acceptanceScore (target Polity 視点)
  const provinceUnrest = averageUnrest
  const rebelPower =
    totalSize * config.popRevoltPowerFactorByClass[popClass] * (0.5 + averageUnrest / 100)
  const suppressionPower = estimateSuppressionPower(state, config, provinceId, targetPolityId)
  const concessionSeverity =
    demand.concessionLevel === 'minor'
      ? config.revoltConcessionSeverityMinor
      : config.revoltConcessionSeverityMajor

  const acceptanceScore =
    provinceUnrest +
    rebelPower * config.revoltAcceptRebelPowerFactor -
    suppressionPower * config.revoltAcceptSuppressionFactor -
    concessionSeverity

  const { nextProgress, nextTension } = applyAcceptanceUpdate(play, acceptanceScore, config)

  let nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress: nextProgress, tension: nextTension },
      },
    },
  }

  if (nextProgress >= config.diplomaticPlaySettlementThreshold) {
    return applyRevoltSettlement(nextCtx, play, demand, rebelPolityId, targetPolityId)
  }
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [rebelPolityId, targetPolityId],
      provinceIds: [provinceId],
      holdingIds: [],
      summary: `Revolt in ${provinceNameKey} has escalated to open conflict.`,
      messageKey: 'diplomatic_play.escalated_revolt',
      messageParams: { province: provinceParam },
      eventEntityRefs: [
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef(
          'polity',
          rebelPolityId,
          'rebel_polity',
          nextCtx.state.polities[rebelPolityId]?.nameKey,
        ),
        entityRef(
          'polity',
          targetPolityId,
          'target_polity',
          nextCtx.state.polities[targetPolityId]?.nameKey,
        ),
      ],
    })
  }
  if (isDeadlineReached(nextCtx.state, play)) {
    // deadline: progress > tension なら settled、tension > progress なら escalated、それ以外 failed (§10.2 step 6)
    if (nextProgress > nextTension) {
      return applyRevoltSettlement(nextCtx, play, demand, rebelPolityId, targetPolityId)
    }
    if (nextTension > nextProgress) {
      const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
      const provinceParam = nameParam('province', provinceNameKey)
      return markPlayEscalated(nextCtx, play.id, {
        polityIds: [rebelPolityId, targetPolityId],
        provinceIds: [provinceId],
        holdingIds: [],
        summary: `Deadlocked revolt in ${provinceNameKey} erupts at deadline.`,
        messageKey: 'diplomatic_play.escalated_revolt',
        messageParams: { province: provinceParam },
        eventEntityRefs: [
          entityRef(
            'province',
            provinceId,
            'province',
            nextCtx.state.provinces[provinceId]?.nameKey,
          ),
          entityRef(
            'polity',
            rebelPolityId,
            'rebel_polity',
            nextCtx.state.polities[rebelPolityId]?.nameKey,
          ),
          entityRef(
            'polity',
            targetPolityId,
            'target_polity',
            nextCtx.state.polities[targetPolityId]?.nameKey,
          ),
        ],
      })
    }
    nextCtx = setPlayStatus(nextCtx, play.id, 'failed')
    const provinceName = nameParam(
      'province',
      nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
    )
    const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'DIPLOMATIC_PLAY_FAILED',
      importance: 'normal',
      messageKey: 'diplomatic_play.failed_revolt',
      messageParams: { province: provinceName },
      entityRefs: [
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef(
          'polity',
          rebelPolityId,
          'rebel_polity',
          nextCtx.state.polities[rebelPolityId]?.nameKey,
        ),
        entityRef(
          'polity',
          targetPolityId,
          'target_polity',
          nextCtx.state.polities[targetPolityId]?.nameKey,
        ),
      ],
    })
    return { ...ctxEv, events: [...ctxEv.events, event] }
  }
  return nextCtx
}

function estimateSuppressionPower(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
  targetPolityId: PolityId,
): number {
  const targetPolity = state.polities[targetPolityId]
  if (!targetPolity) return 1

  const polityManpower = getProvinceManpowerBase(state, config, provinceId)
  let suppressionPower =
    polityManpower * config.provinceRevoltCountrySuppressionFactor +
    Math.log1p(targetPolity.treasury) * config.provinceRevoltTreasurySuppressionFactor
  const targetOwnerHouseId = targetPolity.ownerHouseId
  if (targetOwnerHouseId !== undefined) {
    const ownerHouse = state.houses[targetOwnerHouseId]
    if (ownerHouse) {
      suppressionPower +=
        getProvinceHouseManpowerBase(state, config, provinceId) *
        config.provinceRevoltHouseSuppressionFactor
      suppressionPower +=
        Math.log1p(ownerHouse.wealth) * config.provinceRevoltHouseWealthSuppressionFactor
    }
  }
  return suppressionPower
}

function applyRevoltSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticPlay['primaryDemand'], { kind: 'revolt_concession' }>,
  rebelPolityId: PolityId,
  targetPolityId: PolityId,
): TickContext {
  const config = ctx.config

  const disbandResult = disbandRebelPolity(ctx, {
    rebelPolityId,
    restoreToPolityId: targetPolityId,
    provinceId: demand.provinceId,
    leaderAftermath: pickSettlementAftermath(ctx),
    reason: 'settlement',
  })
  if (!disbandResult.ok) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  let nextCtx = disbandResult.value.ctx
  let state = nextCtx.state

  state = adjustProvincePopUnrestByClass(
    state,
    demand.provinceId,
    demand.popClass,
    -config.revoltSettlementMainUnrestReduction,
  )
  state = adjustProvincePopUnrest(
    state,
    demand.provinceId,
    -config.revoltSettlementOtherUnrestReduction,
  )

  const cost =
    demand.concessionLevel === 'major'
      ? config.revoltSettlementTreasuryCostMajor
      : config.revoltSettlementTreasuryCostMinor
  const targetPolity = state.polities[targetPolityId]
  if (targetPolity) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [targetPolityId]: {
          ...targetPolity,
          treasury: Math.max(0, targetPolity.treasury - cost),
        },
      },
    }
  }

  nextCtx = { ...nextCtx, state }
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  const provinceName = nameParam(
    'province',
    nextCtx.state.provinces[demand.provinceId]?.nameKey ?? demand.provinceId,
  )
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'DIPLOMATIC_PLAY_SETTLED',
    importance: 'major',
    messageKey: 'diplomatic_play.settled_revolt',
    messageParams: { province: provinceName },
    entityRefs: [
      entityRef(
        'province',
        demand.provinceId,
        'province',
        nextCtx.state.provinces[demand.provinceId]?.nameKey,
      ),
      entityRef(
        'polity',
        rebelPolityId,
        'rebel_polity',
        nextCtx.state.polities[rebelPolityId]?.nameKey,
      ),
      entityRef(
        'polity',
        targetPolityId,
        'target_polity',
        nextCtx.state.polities[targetPolityId]?.nameKey,
      ),
    ],
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

function pickSettlementAftermath(ctx: TickContext): RebelLeaderAftermath {
  const { value, rng } = randomFloat(ctx.rng)
  void rng
  return value < 0.5 ? 'returned_to_obscurity' : 'exiled'
}

// ─── land_claim 進行 (Stage F §10.3 / §11、旧 land_purchase + land_transfer_demand 統合) ───

function progressLandClaim(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.primaryDemand.kind !== 'transfer_land_contract') return ctx
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return ctx

  const primary = play.primaryDemand
  const initiatorPolityId = play.initiator.id
  const defenderPolityId = play.target.id
  const holdingId = primary.holdingId
  const provinceId = state.holdings[holdingId]?.provinceId
  if (!provinceId) return setPlayStatus(ctx, play.id, 'cancelled')

  const initiator = state.polities[initiatorPolityId]
  const defender = state.polities[defenderPolityId]
  const province = state.provinces[provinceId]
  if (
    !initiator ||
    !initiator.active ||
    !defender ||
    !defender.active ||
    !province ||
    initiator.ownerHouseId === undefined ||
    defender.ownerHouseId === undefined
  ) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const claimChain = getHoldingLandContractChain(state, holdingId)
  if (!claimChain.some((c) => c.granteePolityId === defenderPolityId)) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // §10.3 融合 acceptanceScore (defender 視点で「土地を手放してもよい」度合い)
  //   acceptanceScore =
  //       offeredPrice * claimOfferedPriceFactor              // 補償金 (高いほど折れる)
  //     + defenderTreasuryNeed                                // 困窮度 (低いほど折れる)
  //     + initiatorPower * claimInitiatorPressureFactor       // 軍事威圧
  //     - defenderPower * claimDefenderResistFactor           // 自軍力 (抵抗)
  //     - provinceValue * claimProvinceValueFactor            // Province 価値
  //     - strategicLoss * claimStrategicLossFactor            // 戦略損失
  //     - prestigeLoss * claimPrestigeLossFactor              // 名誉損失
  const offeredPrice =
    play.counterDemand && play.counterDemand.kind === 'pay_wealth' ? play.counterDemand.amount : 0
  const defenderTreasuryNeed = computeDefenderTreasuryNeed(defender.treasury)
  const initiatorPower =
    getActorMilitaryPower(state, config, play.initiator) *
    calcGeneralWarPowerModifier(state, initiatorPolityId, config)
  const defenderPower =
    getActorMilitaryPower(state, config, play.target) *
    calcGeneralWarPowerModifier(state, defenderPolityId, config)
  const provinceValue = computeProvinceValue(
    getProvinceDevelopmentFromHoldings(state, provinceId, config),
  )
  const strategicLoss = computeStrategicValue(state, provinceId, defenderPolityId)
  const prestigeLoss = computePrestigeLoss(defender.rank)

  const acceptanceScore =
    offeredPrice * config.claimOfferedPriceFactor +
    defenderTreasuryNeed +
    initiatorPower * config.claimInitiatorPressureFactor -
    defenderPower * config.claimDefenderResistFactor -
    provinceValue * config.claimProvinceValueFactor -
    strategicLoss * config.claimStrategicLossFactor -
    prestigeLoss * config.claimPrestigeLossFactor

  const { nextProgress, nextTension } = applyAcceptanceUpdate(play, acceptanceScore, config)

  let nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress: nextProgress, tension: nextTension },
      },
    },
  }

  if (nextProgress >= config.diplomaticPlaySettlementThreshold) {
    return applyLandClaimSettlement(
      nextCtx,
      play,
      primary,
      initiatorPolityId,
      defenderPolityId,
      holdingId,
    )
  }
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${initiatorName ?? initiatorPolityId} mobilises against ${defenderName ?? defenderPolityId} over ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
        province: provinceParam,
      },
      eventEntityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
  }
  if (isDeadlineReached(nextCtx.state, play)) {
    if (nextProgress > nextTension) {
      return applyLandClaimSettlement(
        nextCtx,
        play,
        primary,
        initiatorPolityId,
        defenderPolityId,
        holdingId,
      )
    }
    if (nextTension > nextProgress) {
      const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
      const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
      const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
      const provinceParam = nameParam('province', provinceNameKey)
      return markPlayEscalated(nextCtx, play.id, {
        polityIds: [initiatorPolityId, defenderPolityId],
        provinceIds: [provinceId],
        holdingIds: [holdingId],
        summary: `Deadlocked claim erupts: ${initiatorName ?? initiatorPolityId} attacks for ${provinceNameKey}.`,
        messageKey: 'diplomatic_play.escalated_claim',
        messageParams: {
          initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
          province: provinceParam,
        },
        eventEntityRefs: [
          entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
          entityRef('polity', defenderPolityId, 'defender', defenderName),
          entityRef(
            'province',
            provinceId,
            'province',
            nextCtx.state.provinces[provinceId]?.nameKey,
          ),
          entityRef('holding', holdingId, 'holding'),
        ],
      })
    }
    nextCtx = setPlayStatus(nextCtx, play.id, 'failed')
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
    const provinceName = nameParam(
      'province',
      nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
    )
    const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'DIPLOMATIC_PLAY_FAILED',
      importance: 'normal',
      messageKey: 'diplomatic_play.failed_claim',
      messageParams: {
        initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
        province: provinceName,
      },
      entityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef(
          'polity',
          defenderPolityId,
          'defender',
          nextCtx.state.polities[defenderPolityId]?.nameKey,
        ),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      ],
    })
    return { ...ctxEv, events: [...ctxEv.events, event] }
  }
  return nextCtx
}

// ─── contract_tax_revision 進行 ───

function progressContractTaxRevision(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.primaryDemand.kind !== 'change_contract_tax_rate')
    return setPlayStatus(ctx, play.id, 'cancelled')

  const demand = play.primaryDemand
  const holdingId = demand.holdingId
  const provinceId = state.holdings[holdingId]?.provinceId
  if (!provinceId) return setPlayStatus(ctx, play.id, 'cancelled')

  const contract = state.landContracts[demand.landContractId]
  if (!contract) return setPlayStatus(ctx, play.id, 'cancelled')

  const initiatorPolityId = play.initiator.id as PolityId
  const defenderPolityId = play.target.id as PolityId
  const initiator = state.polities[initiatorPolityId]
  const defender = state.polities[defenderPolityId]
  if (
    !initiator ||
    !initiator.active ||
    !defender ||
    !defender.active ||
    initiator.ownerHouseId === undefined ||
    defender.ownerHouseId === undefined
  ) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // Verify contract still in chain
  const chain = getHoldingLandContractChain(state, holdingId)
  if (!chain.some((c) => c.id === demand.landContractId)) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  const province = state.provinces[provinceId]
  if (!province) return setPlayStatus(ctx, play.id, 'cancelled')

  const currentRate = contract.terms.taxRateToGrantor
  const desiredRate = demand.newTaxRateToGrantor
  const isReduction = desiredRate < currentRate

  const initiatorPower =
    getActorMilitaryPower(state, config, play.initiator) *
    calcGeneralWarPowerModifier(state, initiatorPolityId, config)
  const defenderPower =
    getActorMilitaryPower(state, config, play.target) *
    calcGeneralWarPowerModifier(state, defenderPolityId, config)

  const rateImbalance = isReduction
    ? (currentRate - 0.3) * config.taxRevisionRateImbalanceFactor
    : (0.5 - currentRate) * config.taxRevisionRateImbalanceFactor

  const provinceValue = computeProvinceValue(
    getProvinceDevelopmentFromHoldings(state, provinceId, config),
  )

  const acceptanceScore =
    initiatorPower * config.taxRevisionPressureFactor -
    defenderPower * config.taxRevisionResistFactor +
    rateImbalance -
    provinceValue * config.taxRevisionProvinceValueFactor

  const factor = config.diplomaticPlayStructuralProgressFactor
  let { progress, tension } = play
  if (acceptanceScore > 0) {
    progress += acceptanceScore * factor
    tension += 1 * factor
  } else {
    tension += Math.abs(acceptanceScore) * factor
    progress += 1 * factor
  }

  // Clamp
  progress = Math.min(100, Math.max(0, progress))
  tension = Math.min(100, Math.max(0, tension))

  const nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, progress, tension },
      },
    },
  }

  // Check deadline
  const currentAbsoluteWeek = state.absoluteWeek
  const deadlineReached = currentAbsoluteWeek >= play.deadlineWeek

  // Check thresholds
  if (progress >= config.diplomaticPlaySettlementThreshold) {
    return applyContractTaxRevisionSettlement(nextCtx, play, demand, holdingId)
  }
  if (tension >= config.diplomaticPlayEscalationThreshold) {
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${initiatorName ?? initiatorPolityId} demands tax changes from ${defenderName ?? defenderPolityId} over ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
        province: provinceParam,
      },
      eventEntityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
  }
  if (deadlineReached) {
    if (progress > tension) {
      return applyContractTaxRevisionSettlement(nextCtx, play, demand, holdingId)
    }
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const provinceParam = nameParam('province', provinceNameKey)
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `Tax revision dispute over ${provinceNameKey} escalates to conflict.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: { initiator: nameParam('polity', initiatorName), province: provinceParam },
      eventEntityRefs: [
        entityRef(
          'polity',
          initiatorPolityId,
          'initiator',
          nextCtx.state.polities[initiatorPolityId]?.nameKey,
        ),
        entityRef(
          'polity',
          defenderPolityId,
          'defender',
          nextCtx.state.polities[defenderPolityId]?.nameKey,
        ),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
  }

  return nextCtx
}

function applyContractTaxRevisionSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticPlay['primaryDemand'], { kind: 'change_contract_tax_rate' }>,
  holdingId: HoldingId,
): TickContext {
  const config = ctx.config
  const contract = ctx.state.landContracts[demand.landContractId]
  if (!contract) return setPlayStatus(ctx, play.id, 'cancelled')

  const newRate = demand.newTaxRateToGrantor
  let nextCtx = ctx

  const initiatorPolityId = play.initiator.id as PolityId
  const defenderPolityId = play.target.id as PolityId
  const provinceId = ctx.state.holdings[holdingId]?.provinceId
  if (!provinceId) return setPlayStatus(ctx, play.id, 'cancelled')

  if (newRate >= config.taxRevisionMinRate && newRate <= config.taxRevisionMaxRate) {
    // Normal: adjust tax rate
    const newState = adjustLandContractTaxRate(nextCtx.state, demand.landContractId, newRate)
    nextCtx = { ...nextCtx, state: newState }
    nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

    // Emit CONTRACT_TAX_REVISED
    const provinceName = nameParam(
      'province',
      nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
    )
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey ?? defenderPolityId
    const { event: taxEvent, ctx: ctxEvTax } = createSimEvent(nextCtx, {
      type: 'CONTRACT_TAX_REVISED',
      importance: 'major',
      messageKey: 'land_contract.tax_revised',
      messageParams: {
        province: provinceName,
        rate: Math.round(newRate * 100),
        initiator: nameParam('polity', initiatorName),
        defender: nameParam('polity', defenderName),
      },
      entityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      ],
    })
    nextCtx = { ...ctxEvTax, events: [...ctxEvTax.events, taxEvent] }
  } else {
    // Elimination: remove contract from chain
    const isReduction = newRate < config.taxRevisionMinRate
    const chain = getHoldingLandContractChain(nextCtx.state, holdingId)

    if (isReduction) {
      // Upper elimination: remove defender's (overlord's) contract from chain
      // Find defender's contract in the chain
      const defenderContract = chain.find((c) => c.granteePolityId === defenderPolityId)
      if (!defenderContract) return setPlayStatus(nextCtx, play.id, 'cancelled')
      const oldRateToParent = defenderContract.terms.taxRateToGrantor
      const newState = eliminateContractFromChain(
        nextCtx.state,
        defenderContract.id,
        oldRateToParent,
      )
      nextCtx = { ...nextCtx, state: newState }
    } else {
      // Lower elimination: remove target's (vassal's) contract
      // The subject contract IS the target's contract
      const newState = eliminateContractFromChain(nextCtx.state, demand.landContractId)
      nextCtx = { ...nextCtx, state: newState }
    }

    nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

    // Emit CONTRACT_ELIMINATED
    const provinceName = nameParam(
      'province',
      nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
    )
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey ?? defenderPolityId
    const { event: elimEvent, ctx: ctxEvElim } = createSimEvent(nextCtx, {
      type: 'CONTRACT_ELIMINATED',
      importance: 'major',
      messageKey: 'land_contract.eliminated',
      messageParams: {
        province: provinceName,
        initiator: nameParam('polity', initiatorName),
        defender: nameParam('polity', defenderName),
      },
      entityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      ],
    })
    nextCtx = { ...ctxEvElim, events: [...ctxEvElim.events, elimEvent] }
  }

  // Emit DIPLOMATIC_PLAY_SETTLED
  const provinceName = nameParam(
    'province',
    nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
  )
  const { event: settledEvent, ctx: ctxSettledNext } = createSimEvent(nextCtx, {
    type: 'DIPLOMATIC_PLAY_SETTLED',
    importance: 'major',
    messageKey: 'diplomatic_play.settled_tax',
    messageParams: { province: provinceName },
    entityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef(
        'polity',
        initiatorPolityId,
        'initiator',
        nextCtx.state.polities[initiatorPolityId]?.nameKey,
      ),
      entityRef(
        'polity',
        defenderPolityId,
        'defender',
        nextCtx.state.polities[defenderPolityId]?.nameKey,
      ),
    ],
  })
  nextCtx = { ...ctxSettledNext, events: [...ctxSettledNext.events, settledEvent] }

  return nextCtx
}

// Stage F: counterDemand 有無で reason='purchase' / 'cession' を分岐
function applyLandClaimSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  _primary: Extract<DiplomaticPlay['primaryDemand'], { kind: 'transfer_land_contract' }>,
  initiatorPolityId: PolityId,
  defenderPolityId: PolityId,
  holdingId: HoldingId,
): TickContext {
  const offeredPrice =
    play.counterDemand && play.counterDemand.kind === 'pay_wealth' ? play.counterDemand.amount : 0

  if (offeredPrice > 0) {
    // 補償あり → 購入経路
    const initiator = ctx.state.polities[initiatorPolityId]
    const defender = ctx.state.polities[defenderPolityId]
    if (!initiator || !defender) return setPlayStatus(ctx, play.id, 'cancelled')
    if (initiator.treasury < offeredPrice) {
      return setPlayStatus(ctx, play.id, 'cancelled')
    }

    const transferResult = applyLandContractTransferGoal(ctx, {
      holdingId,
      fromPolityId: defenderPolityId,
      toPolityId: initiatorPolityId,
      reason: 'purchase',
    })
    if (!transferResult.ok) {
      return setPlayStatus(ctx, play.id, 'cancelled')
    }
    let nextCtx = transferResult.value.ctx

    const initiatorNow = nextCtx.state.polities[initiatorPolityId]
    const defenderNow = nextCtx.state.polities[defenderPolityId]
    if (initiatorNow && defenderNow) {
      nextCtx = {
        ...nextCtx,
        state: {
          ...nextCtx.state,
          polities: {
            ...nextCtx.state.polities,
            [initiatorPolityId]: {
              ...initiatorNow,
              treasury: Math.max(0, initiatorNow.treasury - offeredPrice),
            },
            [defenderPolityId]: {
              ...defenderNow,
              treasury: defenderNow.treasury + offeredPrice,
            },
          },
        },
      }
    }

    nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

    const provinceId = nextCtx.state.holdings[holdingId]?.provinceId
    const provinceNameKey = provinceId
      ? (nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId)
      : holdingId
    const provinceParam = nameParam('province', provinceNameKey)
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey ?? defenderPolityId
    const { event: ev, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'DIPLOMATIC_PLAY_SETTLED',
      importance: 'major',
      messageKey: 'diplomatic_play.settled_purchase',
      messageParams: {
        initiator: nameParam('polity', initiatorName),
        province: provinceParam,
        defender: nameParam('polity', defenderName),
        price: Math.round(offeredPrice),
      },
      entityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId!, 'province', provinceNameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
    return { ...ctxEv, events: [...ctxEv.events, ev] }
  }

  // 補償なし → 譲歩経路
  const transferResult = applyLandContractTransferGoal(ctx, {
    holdingId,
    fromPolityId: defenderPolityId,
    toPolityId: initiatorPolityId,
    reason: 'cession',
  })
  if (!transferResult.ok) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  let nextCtx = transferResult.value.ctx
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  const provinceId = nextCtx.state.holdings[holdingId]?.provinceId
  const provinceNameKey = provinceId
    ? (nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId)
    : holdingId
  const provinceParam = nameParam('province', provinceNameKey)
  const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
  const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey ?? defenderPolityId
  const { event: ev, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'DIPLOMATIC_PLAY_SETTLED',
    importance: 'major',
    messageKey: 'diplomatic_play.settled_cession',
    messageParams: {
      defender: nameParam('polity', defenderName),
      province: provinceParam,
      initiator: nameParam('polity', initiatorName),
    },
    entityRefs: [
      entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
      entityRef('polity', defenderPolityId, 'defender', defenderName),
      entityRef('province', provinceId!, 'province', provinceNameKey),
      entityRef('holding', holdingId, 'holding'),
    ],
  })
  return { ...ctxEv, events: [...ctxEv.events, ev] }
}

// ─── 共通 helpers ───

function applyAcceptanceUpdate(
  play: DiplomaticPlay,
  acceptanceScore: number,
  config: SimulationConfig,
): { nextProgress: number; nextTension: number } {
  const factor = config.diplomaticPlayStructuralProgressFactor
  if (acceptanceScore >= 0) {
    return {
      nextProgress: clamp(play.progress + clamp(acceptanceScore * 0.2 * factor, 0.33, 4), 0, 100),
      nextTension: clamp(play.tension + config.diplomaticPlayBaseTensionGain * factor, 0, 100),
    }
  }
  return {
    nextProgress: play.progress,
    nextTension: clamp(play.tension + clamp(-acceptanceScore * 0.2 * factor, 0.33, 4), 0, 100),
  }
}

// status='escalated' (active 系) に設定し DIPLOMATIC_PLAY_ESCALATED event を発火する。
// 同 tick 内の conflictResolutionSystem が拾い上げて 'resolved_by_conflict' に置換する。
function markPlayEscalated(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  eventMeta: {
    polityIds: PolityId[]
    provinceIds: ProvinceId[]
    holdingIds: HoldingId[]
    summary: string
    messageKey: string
    messageParams: EventMessageParams
    eventEntityRefs: EventEntityRef[]
  },
): TickContext {
  const nextCtx = setPlayActiveStatus(ctx, playId, 'escalated')
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'DIPLOMATIC_PLAY_ESCALATED',
    importance: 'major',
    messageKey: eventMeta.messageKey,
    messageParams: eventMeta.messageParams,
    entityRefs: eventMeta.eventEntityRefs,
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
}

function setPlayStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: TerminalDiplomaticPlayStatus,
): TickContext {
  return setPlayAnyStatus(ctx, playId, status)
}

function setPlayActiveStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: 'active' | 'escalated',
): TickContext {
  return setPlayAnyStatus(ctx, playId, status)
}

function setPlayAnyStatus(
  ctx: TickContext,
  playId: DiplomaticPlayId,
  status: DiplomaticPlayStatus,
): TickContext {
  const play = ctx.state.diplomaticPlays[playId]
  if (!play) return ctx
  const log = createLogger(ctx.config.debug)
  log.log('DIPLOMATIC_PLAY', {
    playId,
    kind: play.kind,
    from: play.status,
    to: status,
  })
  return {
    ...ctx,
    state: {
      ...ctx.state,
      diplomaticPlays: {
        ...ctx.state.diplomaticPlays,
        [playId]: { ...play, status },
      },
    },
  }
}

// 旧 computeSellerTreasuryNeed を rename (defender = seller/holder の財政困窮度)
export function computeDefenderTreasuryNeed(treasury: number): number {
  const baseThreshold = 1000
  return clamp((baseThreshold - treasury) * 0.05, 0, 50)
}

export function computeProvinceValue(development: number): number {
  return clamp((development + 100) * 0.5, 0, 100)
}

export function computeStrategicValue(
  state: WorldState,
  provinceId: ProvinceId,
  ownerPolityId: PolityId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let foreignNeighbors = 0
  for (const neighborId of province.neighbors) {
    const terminalPid = getProvinceTerminalPolityId(state, neighborId)
    if (terminalPid && terminalPid !== ownerPolityId) foreignNeighbors++
  }
  return clamp(foreignNeighbors * 25, 0, 100)
}

export function computePrestigeLoss(rank: number): number {
  // rank が高い (= 数値が小さい) 大国ほど Province 喪失の prestige loss が大きい
  // rank 1 → 50, rank 2 → 40, rank 3 → 30, rank 4 → 20, rank 5 → 10
  return clamp(60 - rank * 10, 10, 50)
}

// ─── Delegate management (spec §10: DiplomaticPlaySystem retains delegate alive check) ───

function ensureDelegates(ctx: TickContext, play: DiplomaticPlay): TickContext {
  let currentCtx = ctx

  for (const side of ['initiator', 'target'] as const) {
    const latestPlay = currentCtx.state.diplomaticPlays[play.id]
    if (!latestPlay || latestPlay.status !== 'active') break

    const actor = side === 'initiator' ? latestPlay.initiator : latestPlay.target
    const currentDelegate =
      side === 'initiator'
        ? latestPlay.initiatorDelegatePersonId
        : latestPlay.targetDelegatePersonId

    let hasValidDelegate = false
    if (currentDelegate) {
      const person = currentCtx.state.persons[currentDelegate]
      hasValidDelegate = !!person && person.alive && person.kind !== 'placeholder'
    }

    if (!hasValidDelegate) {
      const otherSideDelegate =
        side === 'initiator'
          ? latestPlay.targetDelegatePersonId
          : latestPlay.initiatorDelegatePersonId
      const newDelegate = getDiplomaticPlayDelegate(currentCtx.state, actor, otherSideDelegate)
      if (!newDelegate) continue

      const updatedPlay = { ...currentCtx.state.diplomaticPlays[play.id]! }
      if (side === 'initiator') {
        updatedPlay.initiatorDelegatePersonId = newDelegate
      } else {
        updatedPlay.targetDelegatePersonId = newDelegate
      }
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          diplomaticPlays: {
            ...currentCtx.state.diplomaticPlays,
            [play.id]: updatedPlay,
          },
        },
      }
    }
  }

  return currentCtx
}
