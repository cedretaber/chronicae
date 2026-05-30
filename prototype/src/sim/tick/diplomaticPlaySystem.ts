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
import { adjustProvincePopUnrestByClass, adjustProvincePopUnrest } from '../mutations/popMutations'
import { disbandRebelPolity, type RebelLeaderAftermath } from '../mutations/worldStructureMutations'
import { getProvincePops } from '../selectors/popSelectors'
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
  const config = ctx.config
  const state = ctx.state
  if (!play.primaryDemand || play.primaryDemand.kind !== 'revolt_concession') return ctx

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
  demand: Extract<DiplomaticDemand, { kind: 'revolt_concession' }>,
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
