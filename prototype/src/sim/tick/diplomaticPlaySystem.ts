import type { TickContext } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import type { DiplomaticPlayId, PolityId, ProvinceId, HoldingId } from '../types/ids'
import type {
  DiplomaticPlay,
  DiplomaticDemand,
  DiplomaticOffer,
  DiplomaticPlayStatus,
  TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'
import type { EventEntityRef, EventMessageParams } from '../types/event'
import { entityRef, nameParam } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { adjustProvincePopUnrestByClass } from '../mutations/popMutations'
import { adjustPopAttitude, adjustHouseMembersAttitude } from '../mutations/attitudeMutations'
import { dissolveNegotiatingCommonwealth } from '../mutations/worldStructureMutations'
import {
  adjustLandContractTaxRate,
  createChildLandContract,
} from '../mutations/landContractMutations'
import { createRegiment } from '../mutations/regimentMutations'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { createOrganizationShare, removeSharesByOrganization } from '../mutations/shareMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import { getHoldingPopSizeByClass } from '../selectors/popSelectors'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import {
  getProvinceTerminalPolityId,
  getHoldingLandContractChain,
} from '../selectors/landContractSelectors'
import { getDiplomaticPlayDelegate } from '../selectors/taskSelectors'
import { validateOffer, evaluateOffer, getOfferEvaluator } from './diplomaticOfferEvaluation'
import { applySettledOffer } from '../mutations/diplomaticOfferMutations'
import { randomFloat } from '../rng/rng'
import { createLogger } from '../debug/logger'

// DiplomaticPlaySystem: active な DiplomaticPlay を毎 tick 進行させる。
//
// v0.30 offer-driven モデル (land_claim / contract_tax_revision):
//   - structural tension を毎 tick 微増
//   - 新 offer が currentOfferId に設定された tick のみ evaluateOffer を実行
//   - accepted → settled、rejected → tension 上昇、play は active 継続
//   - tension >= escalationThreshold → escalated
//   - deadline 到達 → always escalated (no 'failed')
//
// revolt_negotiation (旧モデル維持):
//   - acceptanceScore で progress / tension を更新
//   - progress >= settlementThreshold → settled
//   - deadline → progress > tension なら settled、else escalated / failed
//
// 'escalated' は active 系 status。ConflictResolutionSystem が同 tick 中に解決する。

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
      if (play.issue.kind === 'land_claim') {
        if (!ctx.state.holdings[play.issue.holdingId]) shouldCancel = true
        if (!ctx.state.provinces[play.issue.provinceId]) shouldCancel = true
      }
      if (play.issue.kind === 'contract_tax_revision') {
        if (!ctx.state.holdings[play.issue.holdingId]) shouldCancel = true
        const contract = ctx.state.landContracts[play.issue.landContractId]
        if (!contract) {
          shouldCancel = true
        } else {
          const holdingChain = ctx.state.landContractIndex.byHolding[play.issue.holdingId] ?? []
          if (!holdingChain.includes(play.issue.landContractId)) shouldCancel = true
        }
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
  const state = ctx.state

  if (play.target.kind !== 'polity') return ctx
  const targetPolityId = play.target.id
  if (play.initiator.kind !== 'polity') return ctx
  const commonwealthId = play.initiator.id

  const targetPolity = state.polities[targetPolityId]
  const commonwealth = state.polities[commonwealthId]
  if (!targetPolity || !targetPolity.active || !commonwealth || !commonwealth.active) {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }

  // v0.39: popular_tax_relief demand path
  if (play.primaryDemand?.kind === 'popular_tax_relief') {
    return progressPopularTaxRelief(ctx, play, play.primaryDemand, commonwealthId, targetPolityId)
  }

  return ctx
}

function progressPopularTaxRelief(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
): TickContext {
  const config = ctx.config
  const state = ctx.state
  const holdingId = demand.holdingId
  const popClass = demand.claimantPopClass

  const holding = state.holdings[holdingId]
  if (!holding) return setPlayStatus(ctx, play.id, 'cancelled')
  const provinceId = holding.provinceId

  const popIds = state.popIndex.byHolding[holdingId]
  let totalSize = 0
  let weightedUnrest = 0
  if (popIds) {
    for (const popId of popIds) {
      const p = state.popGroups[popId]
      if (!p || p.class !== popClass) continue
      totalSize += p.size
      weightedUnrest += p.unrest * p.size
    }
  }
  const averageUnrest = totalSize > 0 ? weightedUnrest / totalSize : 0

  if (totalSize === 0) return setPlayStatus(ctx, play.id, 'cancelled')

  const rebelPower =
    totalSize * config.popRevoltPowerFactorByClass[popClass] * (0.5 + averageUnrest / 100)
  const suppressionPower = estimateSuppressionPower(state, config, provinceId, targetPolityId)
  const taxReliefSeverity =
    (demand.currentTaxRate - demand.demandedTaxRate) * config.taxReliefSeverityFactor

  const acceptanceScore =
    averageUnrest +
    rebelPower * config.revoltAcceptRebelPowerFactor -
    suppressionPower * config.revoltAcceptSuppressionFactor -
    taxReliefSeverity

  const { nextProgress, nextTension } = applyAcceptanceUpdate(play, acceptanceScore, config)

  const nextCtx: TickContext = {
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
    return applyPopularTaxReliefSettlement(
      nextCtx,
      play,
      demand,
      commonwealthId,
      targetPolityId,
      provinceId,
    )
  }

  // INV-1: Phase B では escalated にしない。dissolution + failed で処理。
  if (
    nextTension >= config.diplomaticPlayEscalationThreshold ||
    (isDeadlineReached(nextCtx.state, play) && nextTension >= nextProgress)
  ) {
    return applyRevoltEscalation(nextCtx, play, demand, commonwealthId, targetPolityId, provinceId)
  }

  if (isDeadlineReached(nextCtx.state, play)) {
    if (nextProgress > nextTension) {
      return applyPopularTaxReliefSettlement(
        nextCtx,
        play,
        demand,
        commonwealthId,
        targetPolityId,
        provinceId,
      )
    }
    // Equal or no winner: fail
    return applyRevoltEscalation(nextCtx, play, demand, commonwealthId, targetPolityId, provinceId)
  }
  return nextCtx
}

function applyPopularTaxReliefSettlement(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const config = ctx.config
  let state = ctx.state

  // 1. Tax rate reduction
  state = adjustLandContractTaxRate(state, demand.targetContractId, demand.demandedTaxRate)

  // 2. Terms protection + history tracking
  const contract = state.landContracts[demand.targetContractId]
  if (contract) {
    state = {
      ...state,
      landContracts: {
        ...state.landContracts,
        [demand.targetContractId]: {
          ...contract,
          termsProtectedUntilWeek: state.absoluteWeek + config.popularTaxReliefTermsProtectionWeeks,
          lastTaxChangedWeek: state.absoluteWeek,
          previousTaxRate: demand.currentTaxRate,
        },
      },
    }
  }

  // 3. Reduce unrest
  state = adjustProvincePopUnrestByClass(
    state,
    provinceId,
    demand.claimantPopClass,
    -config.revoltSettlementMainUnrestReduction,
  )

  // 4. Record settlement on Holding
  const holding = state.holdings[demand.holdingId]
  if (holding) {
    state = {
      ...state,
      holdings: {
        ...state.holdings,
        [demand.holdingId]: { ...holding, lastRevoltSettledWeek: state.absoluteWeek },
      },
    }
  }

  // 5. Dissolve commonwealth (leader survives)
  let nextCtx: TickContext = { ...ctx, state }
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: commonwealthId,
    leaderOutcome: 'alive',
  })
  if (dissolveResult.ok) {
    nextCtx = dissolveResult.value.ctx
  }

  // 6. Set play status
  nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

  // 7. Event
  const provinceName = nameParam(
    'province',
    nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
  )
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_SETTLED',
    importance: 'major',
    messageKey: 'revolt.settled_pardoned',
    messageParams: {
      province: provinceName,
      restorePolity: nameParam(
        'polity',
        nextCtx.state.polities[targetPolityId]?.nameKey ?? targetPolityId,
      ),
    },
    entityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef('polity', commonwealthId, 'rebel_polity'),
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

function applyRevoltEscalation(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  const config = ctx.config
  const targetPolity = ctx.state.polities[targetPolityId]

  // rank 5 → Phase D internal revolt (transitional: dissolve + fail)
  if (targetPolity && targetPolity.rank === 5) {
    return resolveInternalRevolt(ctx, play, demand, commonwealthId, targetPolityId, provinceId)
  }

  // rank 2-4: revolt_seizure contract + Local Levy + escalated
  let state = ctx.state

  // 1. Add revolt_seizure child contract
  const holdingChain = state.landContractIndex.byHolding[demand.holdingId] ?? []
  const terminalContractId = holdingChain[holdingChain.length - 1]
  if (!terminalContractId) return setPlayStatus(ctx, play.id, 'failed')

  const createResult = createChildLandContract(state, {
    provinceId,
    parentContractId: terminalContractId,
    granteePolityId: commonwealthId,
    taxRateToGrantor: 0,
    holdingId: demand.holdingId,
    specialStatus: {
      kind: 'revolt_seizure',
      revoltPolityId: commonwealthId,
      originalTerminalPolityId: targetPolityId,
      startedWeek: state.absoluteWeek,
    },
  })
  state = createResult.state
  const seizureContractId = createResult.contractId

  // 2. Create Local Levy
  const peasants = getHoldingPopSizeByClass(state, demand.holdingId, 'peasants')
  const townsmen = getHoldingPopSizeByClass(state, demand.holdingId, 'townsmen')
  const nobles = getHoldingPopSizeByClass(state, demand.holdingId, 'nobles')
  const levyStrength = Math.max(
    config.localLevyMinStrength,
    Math.min(
      config.localLevyMaxStrength,
      peasants * config.localLevyPeasantFactor +
        townsmen * config.localLevyTownsmenFactor +
        nobles * config.localLevyNobleFactor,
    ),
  )
  const holding = state.holdings[demand.holdingId]
  if (holding) {
    const levy = createRegiment(state, {
      owner: { kind: 'polity', id: commonwealthId },
      sourceKind: 'local_levy',
      troopKind: 'infantry',
      homeHoldingId: demand.holdingId,
      homeProvinceId: provinceId,
      strength: levyStrength,
      organization: config.localLevyOrganization,
      morale: config.localLevyMorale,
      maxStrength: levyStrength,
      basePower: levyStrength * config.localLevyBasePowerFactor,
      baselineOrganization: config.localLevyOrganization,
      maxOrganization: 50,
      baselineMorale: config.localLevyMorale,
      maxMorale: 50,
      createdWeek: state.absoluteWeek,
    })
    levy.disbandAfterWar = true
  }

  // 3. Update revoltState to revolting
  const commonwealth = state.polities[commonwealthId]
  if (commonwealth) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [commonwealthId]: {
          ...commonwealth,
          revoltState: {
            kind: 'revolting',
            revoltSeizureContractIds: [seizureContractId],
          },
        },
      },
    }
  }

  // 4. Mark play escalated (warCreationSystem will consume)
  let nextCtx: TickContext = { ...ctx, state }
  const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
  nextCtx = markPlayEscalated(nextCtx, play.id, {
    polityIds: [commonwealthId, targetPolityId],
    provinceIds: [provinceId],
    holdingIds: [demand.holdingId],
    summary: `Revolt in ${provinceNameKey} has escalated to armed conflict.`,
    messageKey: 'diplomatic_play.escalated_revolt',
    messageParams: { province: nameParam('province', provinceNameKey) },
    eventEntityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef('polity', commonwealthId, 'rebel_polity'),
      entityRef(
        'polity',
        targetPolityId,
        'target_polity',
        nextCtx.state.polities[targetPolityId]?.nameKey,
      ),
    ],
  })

  // Emit REVOLT_ESCALATED
  const provinceName = nameParam('province', provinceNameKey)
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_ESCALATED',
    importance: 'major',
    messageKey: 'revolt.escalated',
    messageParams: { province: provinceName },
    entityRefs: [
      entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
      entityRef('polity', commonwealthId, 'rebel_polity'),
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

function resolveInternalRevolt(
  ctx: TickContext,
  play: DiplomaticPlay,
  demand: Extract<DiplomaticDemand, { kind: 'popular_tax_relief' }>,
  commonwealthId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): TickContext {
  let state = ctx.state
  const holdingId = demand.holdingId

  // Simple force comparison (spec §13.6)
  const popIds = state.popIndex.byHolding[holdingId]
  let totalSize = 0
  let weightedUnrest = 0
  if (popIds) {
    for (const popId of popIds) {
      const p = state.popGroups[popId]
      if (!p || p.class !== demand.claimantPopClass) continue
      totalSize += p.size
      weightedUnrest += p.unrest * p.size
    }
  }
  const avgUnrest = totalSize > 0 ? weightedUnrest / totalSize : 0

  const cwOrigin = state.polities[commonwealthId]?.origin
  const leaderPersonId = cwOrigin?.kind === 'popular_revolt' ? cwOrigin.leaderPersonId : undefined
  const leader = leaderPersonId ? state.persons[leaderPersonId] : undefined
  const leaderBonus = leader
    ? leader.abilities.charisma * 0.5 + leader.abilities.command * 0.5 + leader.traits.ambition * 30
    : 0

  const rebelPower = totalSize * 0.5 * (0.5 + avgUnrest / 100) + leaderBonus

  const targetPolity = state.polities[targetPolityId]
  const targetLeaderId = targetPolity ? getPolityLeader(state, targetPolityId) : undefined
  const targetLeader = targetLeaderId ? state.persons[targetLeaderId] : undefined
  const defenderBonus = targetLeader
    ? targetLeader.abilities.command * 0.5 + targetLeader.traits.caution * 20
    : 0
  const holding = state.holdings[holdingId]
  const polityControl = holding?.polityControl ?? 50
  const defenderPower = polityControl * 0.5 + defenderBonus

  const successChance = rebelPower / (rebelPower + defenderPower + 1)
  const { value: roll, rng: nextRng } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: nextRng }
  const success = roll < successChance

  if (success && targetPolity && leaderPersonId && leader) {
    // Internal revolt success: regime change
    // 1. Transform target polity
    state = {
      ...state,
      polities: {
        ...state.polities,
        [targetPolityId]: {
          ...targetPolity,
          kind: 'commonwealth',
          ownerHouseId: undefined,
          origin: {
            kind: 'regime_changed_by_popular_revolt',
            previousOwnerHouseId: targetPolity.ownerHouseId,
            provinceId,
            holdingId,
            popClass: demand.claimantPopClass,
            leaderPersonId,
            week: state.absoluteWeek,
          },
          revoltState: { kind: 'established' },
        },
      },
    }

    // 2. Revoke old leader, appoint rebel leader
    state = revokeOfficesByOrganization(state, { kind: 'polity', id: targetPolityId }, 'leader')
    state = removeSharesByOrganization(state, { kind: 'polity', id: targetPolityId })
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: targetPolityId },
      'leader',
      leaderPersonId,
    )
    state = createOrganizationShare(
      state,
      { kind: 'polity', id: targetPolityId },
      { kind: 'person', id: leaderPersonId },
      100,
    )

    // 3. Tax reduction
    state = adjustLandContractTaxRate(state, demand.targetContractId, demand.demandedTaxRate)

    // 4. Unrest reduction
    state = adjustProvincePopUnrestByClass(state, provinceId, demand.claimantPopClass, -30)

    // 4b. POP attitude boost toward new commonwealth (§14.5)
    const popIds = state.popIndex.byHolding[holdingId]
    if (popIds) {
      for (const popId of popIds) {
        const r = adjustPopAttitude(
          state,
          popId,
          { kind: 'polity', id: targetPolityId },
          { affection: 15, respect: 10 },
        )
        if (r.ok) state = r.value
      }
    }
    // 4c. Old owner house members attitude penalty toward new regime (§14.5)
    if (targetPolity.ownerHouseId !== undefined) {
      const r = adjustHouseMembersAttitude(
        state,
        targetPolity.ownerHouseId,
        { kind: 'polity', id: targetPolityId },
        { affection: -20, respect: -10 },
      )
      if (r.ok) state = r.value
    }

    // 5. Dissolve negotiating commonwealth
    let nextCtx: TickContext = { ...ctx, state }
    const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
      commonwealthPolityId: commonwealthId,
      leaderOutcome: 'alive',
    })
    if (dissolveResult.ok) nextCtx = dissolveResult.value.ctx

    nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')

    const provinceName = nameParam(
      'province',
      nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
    )
    const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'REVOLT_REGIME_CHANGED',
      importance: 'critical',
      messageKey: 'revolt.regime_changed',
      messageParams: { province: provinceName },
      entityRefs: [
        entityRef('province', provinceId, 'province'),
        entityRef('polity', targetPolityId, 'polity'),
        entityRef('person', leaderPersonId, 'leader'),
      ],
    })
    return { ...ctxEv, events: [...ctxEv.events, event] }
  }

  // Internal revolt failure: suppression
  state = adjustProvincePopUnrestByClass(state, provinceId, demand.claimantPopClass, -20)

  if (holding) {
    state = {
      ...state,
      holdings: {
        ...state.holdings,
        [holdingId]: {
          ...state.holdings[holdingId]!,
          lastRevoltSuppressedWeek: state.absoluteWeek,
        },
      },
    }
  }

  let nextCtx: TickContext = { ...ctx, state }
  const leaderOutcome: 'executed' | 'pardoned' =
    roll < successChance * 0.5 ? 'pardoned' : 'executed'
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: commonwealthId,
    leaderOutcome,
  })
  if (dissolveResult.ok) nextCtx = dissolveResult.value.ctx

  nextCtx = setPlayStatus(nextCtx, play.id, 'resolved_by_conflict')

  const provinceName = nameParam(
    'province',
    nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId,
  )
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_SUPPRESSED',
    importance: 'major',
    messageKey:
      leaderOutcome === 'executed' ? 'revolt.suppressed_executed' : 'revolt.suppressed_pardoned',
    messageParams: {
      province: provinceName,
      restorePolity: nameParam('polity', targetPolity?.nameKey ?? ''),
    },
    entityRefs: [
      entityRef('province', provinceId, 'province'),
      entityRef('polity', targetPolityId, 'polity'),
    ],
  })
  return { ...ctxEv, events: [...ctxEv.events, event] }
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

// ─── land_claim 進行 (v0.30 Phase B: offer-driven evaluation) ───

function progressLandClaim(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return ctx

  const initiatorPolityId = play.initiator.id
  const defenderPolityId = play.target.id

  // Get holdingId from issue
  if (!play.issue || play.issue.kind !== 'land_claim') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const holdingId = play.issue.holdingId

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

  // Structural tension update (every tick)
  const factor = config.diplomaticPlayStructuralProgressFactor
  let nextTension = clamp(play.tension + config.diplomaticPlayBaseTensionGain * factor, 0, 100)
  let nextProgress = play.progress

  // Build play update object
  const playUpdate: Partial<DiplomaticPlay> = {}
  const offersUpdate: Record<string, DiplomaticOffer> = {}

  // Offer evaluation (only when new offer exists)
  const currentOfferId = play.currentOfferId
  const needsEvaluation = currentOfferId && currentOfferId !== play.lastEvaluatedOfferId
  let offerAccepted = false
  let acceptedOffer: DiplomaticOffer | undefined

  if (needsEvaluation) {
    const offer = state.diplomaticOffers[currentOfferId]
    if (offer) {
      const validation = validateOffer(state, config, play, offer)
      if (!validation.valid) {
        offersUpdate[currentOfferId as string] = { ...offer, status: 'rejected' }
        playUpdate.lastRejectedOfferId = currentOfferId
        playUpdate.lastEvaluatedOfferId = currentOfferId
        nextTension = clamp(nextTension + config.invalidOfferTensionDelta, 0, 100)
      } else {
        const evaluator = getOfferEvaluator(play, offer)
        const evaluation = evaluateOffer(state, config, play, offer, evaluator)
        playUpdate.lastEvaluatedOfferId = currentOfferId
        nextProgress = clamp(nextProgress + config.validOfferProgressDelta, 0, 100)
        if (evaluation.accepted) {
          offersUpdate[currentOfferId as string] = { ...offer, status: 'accepted' }
          offerAccepted = true
          acceptedOffer = offer
        } else {
          offersUpdate[currentOfferId as string] = { ...offer, status: 'rejected' }
          playUpdate.lastRejectedOfferId = currentOfferId
          nextProgress = clamp(nextProgress + evaluation.progressDelta, 0, 100)
          nextTension = clamp(nextTension + evaluation.tensionDelta, 0, 100)
        }
      }
    }
  }

  // Apply state updates
  let nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, ...playUpdate, progress: nextProgress, tension: nextTension },
      },
      diplomaticOffers: {
        ...state.diplomaticOffers,
        ...offersUpdate,
      },
    },
  }

  // Handle accepted offer -> settlement
  if (offerAccepted && acceptedOffer) {
    nextCtx = applySettledOffer(nextCtx, play, acceptedOffer)
    nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

    const hasPay = acceptedOffer.demands.some((d) => d.kind === 'pay_wealth')
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey ?? defenderPolityId
    const payAmount = acceptedOffer.demands.find((d) => d.kind === 'pay_wealth')
    const { event: ev, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'DIPLOMATIC_PLAY_SETTLED',
      importance: 'major',
      messageKey: hasPay ? 'diplomatic_play.settled_purchase' : 'diplomatic_play.settled_cession',
      messageParams: {
        initiator: nameParam('polity', initiatorName),
        province: nameParam('province', provinceNameKey),
        defender: nameParam('polity', defenderName),
        ...(payAmount && payAmount.kind === 'pay_wealth'
          ? { price: Math.round(payAmount.amount) }
          : {}),
      },
      entityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', provinceNameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
    return { ...ctxEv, events: [...ctxEv.events, ev] }
  }

  // Escalation check
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${initiatorName ?? initiatorPolityId} mobilises against ${defenderName ?? defenderPolityId} over ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
        province: nameParam('province', provinceNameKey),
      },
      eventEntityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
  }

  // Deadline check -- no 'failed', always escalate
  if (isDeadlineReached(nextCtx.state, play)) {
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `Deadlocked claim erupts: ${initiatorName ?? initiatorPolityId} attacks for ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
        province: nameParam('province', provinceNameKey),
      },
      eventEntityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
  }

  return nextCtx
}

// ─── contract_tax_revision 進行 (v0.30 Phase B: offer-driven evaluation) ───

function progressContractTaxRevision(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return ctx

  const initiatorPolityId = play.initiator.id
  const defenderPolityId = play.target.id

  // Get holdingId from issue
  if (!play.issue || play.issue.kind !== 'contract_tax_revision') {
    return setPlayStatus(ctx, play.id, 'cancelled')
  }
  const holdingId = play.issue.holdingId

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

  // Verify contract still in chain
  const landContractId = play.issue.landContractId
  {
    const chain = getHoldingLandContractChain(state, holdingId)
    if (!chain.some((c) => c.id === landContractId)) {
      return setPlayStatus(ctx, play.id, 'cancelled')
    }
  }

  // Structural tension update (every tick)
  const factor = config.diplomaticPlayStructuralProgressFactor
  let nextTension = clamp(play.tension + config.diplomaticPlayBaseTensionGain * factor, 0, 100)
  let nextProgress = play.progress

  // Build play update object
  const playUpdate: Partial<DiplomaticPlay> = {}
  const offersUpdate: Record<string, DiplomaticOffer> = {}

  // Offer evaluation (only when new offer exists)
  const currentOfferId = play.currentOfferId
  const needsEvaluation = currentOfferId && currentOfferId !== play.lastEvaluatedOfferId
  let offerAccepted = false
  let acceptedOffer: DiplomaticOffer | undefined

  if (needsEvaluation) {
    const offer = state.diplomaticOffers[currentOfferId]
    if (offer) {
      const validation = validateOffer(state, config, play, offer)
      if (!validation.valid) {
        offersUpdate[currentOfferId as string] = { ...offer, status: 'rejected' }
        playUpdate.lastRejectedOfferId = currentOfferId
        playUpdate.lastEvaluatedOfferId = currentOfferId
        nextTension = clamp(nextTension + config.invalidOfferTensionDelta, 0, 100)
      } else {
        const evaluator = getOfferEvaluator(play, offer)
        const evaluation = evaluateOffer(state, config, play, offer, evaluator)
        playUpdate.lastEvaluatedOfferId = currentOfferId
        nextProgress = clamp(nextProgress + config.validOfferProgressDelta, 0, 100)
        if (evaluation.accepted) {
          offersUpdate[currentOfferId as string] = { ...offer, status: 'accepted' }
          offerAccepted = true
          acceptedOffer = offer
        } else {
          offersUpdate[currentOfferId as string] = { ...offer, status: 'rejected' }
          playUpdate.lastRejectedOfferId = currentOfferId
          nextProgress = clamp(nextProgress + evaluation.progressDelta, 0, 100)
          nextTension = clamp(nextTension + evaluation.tensionDelta, 0, 100)
        }
      }
    }
  }

  // Apply state updates
  let nextCtx: TickContext = {
    ...ctx,
    state: {
      ...state,
      diplomaticPlays: {
        ...state.diplomaticPlays,
        [play.id]: { ...play, ...playUpdate, progress: nextProgress, tension: nextTension },
      },
      diplomaticOffers: {
        ...state.diplomaticOffers,
        ...offersUpdate,
      },
    },
  }

  // Handle accepted offer -> settlement
  if (offerAccepted && acceptedOffer) {
    // v0.34: 税率改定の before を applySettledOffer 前に捕捉する (歴史記述: 元→新)。
    const preTaxDemand = acceptedOffer.demands.find((d) => d.kind === 'change_contract_tax_rate')
    const beforeTaxRate =
      preTaxDemand && preTaxDemand.kind === 'change_contract_tax_rate'
        ? nextCtx.state.landContracts[preTaxDemand.landContractId]?.terms.taxRateToGrantor
        : undefined

    nextCtx = applySettledOffer(nextCtx, play, acceptedOffer)
    nextCtx = setPlayStatus(nextCtx, play.id, 'settled')

    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId

    // Emit CONTRACT_TAX_REVISED or CONTRACT_ELIMINATED based on the accepted offer
    const taxDemand = acceptedOffer.demands.find((d) => d.kind === 'change_contract_tax_rate')
    if (taxDemand && taxDemand.kind === 'change_contract_tax_rate') {
      const isElimination =
        taxDemand.newTaxRateToGrantor <= nextCtx.config.taxRevisionMinRate ||
        taxDemand.newTaxRateToGrantor >= nextCtx.config.taxRevisionMaxRate
      const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
      const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey ?? defenderPolityId
      const eventType = isElimination ? 'CONTRACT_ELIMINATED' : 'CONTRACT_TAX_REVISED'
      const messageKey = isElimination ? 'land_contract.eliminated' : 'land_contract.tax_revised'
      const { event: taxEvent, ctx: ctxEvTax } = createSimEvent(nextCtx, {
        type: eventType,
        importance: 'major',
        messageKey,
        messageParams: {
          province: nameParam('province', provinceNameKey),
          // v0.34: 歴史記述用に before→after を記録 (rate は後方互換のため残置)。
          fromRate: Math.round((beforeTaxRate ?? taxDemand.newTaxRateToGrantor) * 100),
          toRate: Math.round(taxDemand.newTaxRateToGrantor * 100),
          rate: Math.round(taxDemand.newTaxRateToGrantor * 100),
          initiator: nameParam('polity', initiatorName),
          defender: nameParam('polity', defenderName),
        },
        entityRefs: [
          entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
          entityRef('polity', defenderPolityId, 'defender', defenderName),
          entityRef(
            'province',
            provinceId,
            'province',
            nextCtx.state.provinces[provinceId]?.nameKey,
          ),
        ],
      })
      nextCtx = { ...ctxEvTax, events: [...ctxEvTax.events, taxEvent] }
    }

    // Emit DIPLOMATIC_PLAY_SETTLED
    const { event: settledEvent, ctx: ctxSettled } = createSimEvent(nextCtx, {
      type: 'DIPLOMATIC_PLAY_SETTLED',
      importance: 'major',
      messageKey: 'diplomatic_play.settled_tax',
      messageParams: { province: nameParam('province', provinceNameKey) },
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
    return { ...ctxSettled, events: [...ctxSettled.events, settledEvent] }
  }

  // Escalation check
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${initiatorName ?? initiatorPolityId} demands tax changes from ${defenderName ?? defenderPolityId} over ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
        province: nameParam('province', provinceNameKey),
      },
      eventEntityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
  }

  // Deadline check -- always escalate (no 'failed')
  if (isDeadlineReached(nextCtx.state, play)) {
    const initiatorName = nextCtx.state.polities[initiatorPolityId]?.nameKey
    const defenderName = nextCtx.state.polities[defenderPolityId]?.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `Tax revision dispute over ${provinceNameKey} escalates to conflict.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam('polity', initiatorName ?? initiatorPolityId),
        province: nameParam('province', provinceNameKey),
      },
      eventEntityRefs: [
        entityRef('polity', initiatorPolityId, 'initiator', initiatorName),
        entityRef('polity', defenderPolityId, 'defender', defenderName),
        entityRef('province', provinceId, 'province', nextCtx.state.provinces[provinceId]?.nameKey),
        entityRef('holding', holdingId, 'holding'),
      ],
    })
  }

  return nextCtx
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
