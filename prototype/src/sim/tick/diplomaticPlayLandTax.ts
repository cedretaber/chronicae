import type { TickContext } from './context'
import { createSimEvent } from './context'
import { clamp } from '../utils/math'
import type { DiplomaticPlay, DiplomaticOffer } from '../types/diplomaticPlay'
import { entityRef, nameParam } from '../types/event'
import {
  getHoldingLandContractChain,
  isContractEliminationRate,
} from '../selectors/landContractSelectors'
import { getPolityNameRefForEmit, getPolityEmitNameKey } from '../selectors/nameRefSelectors'
import { validateOffer, evaluateOffer, getOfferEvaluator } from './diplomaticOfferEvaluation'
import { applySettledOffer } from '../mutations/diplomaticOfferMutations'
import {
  isDeadlineReached,
  markPlayEscalated,
  setPlayStatus,
  classifySettledOutcome,
} from './diplomaticPlayHelpers'

// ─── land_claim 進行 (v0.30 Phase B: offer-driven evaluation) ───

export function progressLandClaim(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return ctx

  const initiatorPolityId = play.initiator.id
  const defenderPolityId = play.target.id

  // Get holdingId from issue
  if (!play.issue || play.issue.kind !== 'land_claim') {
    return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
  }
  const holdingId = play.issue.holdingId

  const provinceId = state.holdings[holdingId]?.provinceId
  if (!provinceId) return setPlayStatus(ctx, play.id, 'cancelled', 'voided')

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
    return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
  }
  const claimChain = getHoldingLandContractChain(state, holdingId)
  if (!claimChain.some((c) => c.granteePolityId === defenderPolityId)) {
    return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
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
    nextCtx = setPlayStatus(nextCtx, play.id, 'settled', classifySettledOutcome(acceptedOffer))

    const hasPay = acceptedOffer.demands.some((d) => d.kind === 'pay_wealth')
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    const initiatorRef = getPolityNameRefForEmit(nextCtx.state, initiatorPolityId)
    const defenderRef = getPolityNameRefForEmit(nextCtx.state, defenderPolityId)
    const initiatorName = initiatorRef.nameKey
    const defenderName = defenderRef.nameKey
    const payAmount = acceptedOffer.demands.find((d) => d.kind === 'pay_wealth')
    const { event: ev, ctx: ctxEv } = createSimEvent(nextCtx, {
      type: 'DIPLOMATIC_PLAY_SETTLED',
      importance: 'major',
      messageKey: hasPay ? 'diplomatic_play.settled_purchase' : 'diplomatic_play.settled_cession',
      messageParams: {
        initiator: nameParam(initiatorRef.category, initiatorName),
        province: nameParam('province', provinceNameKey),
        defender: nameParam(defenderRef.category, defenderName),
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
    const initiatorRef = getPolityNameRefForEmit(nextCtx.state, initiatorPolityId)
    const defenderRef = getPolityNameRefForEmit(nextCtx.state, defenderPolityId)
    const initiatorName = initiatorRef.nameKey
    const defenderName = defenderRef.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${initiatorName} mobilises against ${defenderName} over ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam(initiatorRef.category, initiatorName),
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
    const initiatorRef = getPolityNameRefForEmit(nextCtx.state, initiatorPolityId)
    const defenderRef = getPolityNameRefForEmit(nextCtx.state, defenderPolityId)
    const initiatorName = initiatorRef.nameKey
    const defenderName = defenderRef.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `Deadlocked claim erupts: ${initiatorName} attacks for ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam(initiatorRef.category, initiatorName),
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

export function progressContractTaxRevision(ctx: TickContext, play: DiplomaticPlay): TickContext {
  const config = ctx.config
  const state = ctx.state
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return ctx

  const initiatorPolityId = play.initiator.id
  const defenderPolityId = play.target.id

  // Get holdingId from issue
  if (!play.issue || play.issue.kind !== 'contract_tax_revision') {
    return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
  }
  const holdingId = play.issue.holdingId

  const provinceId = state.holdings[holdingId]?.provinceId
  if (!provinceId) return setPlayStatus(ctx, play.id, 'cancelled', 'voided')

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
    return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
  }

  // Verify contract still in chain
  const landContractId = play.issue.landContractId
  {
    const chain = getHoldingLandContractChain(state, holdingId)
    if (!chain.some((c) => c.id === landContractId)) {
      return setPlayStatus(ctx, play.id, 'cancelled', 'voided')
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
    nextCtx = setPlayStatus(nextCtx, play.id, 'settled', classifySettledOutcome(acceptedOffer))

    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId

    // Emit CONTRACT_TAX_REVISED or CONTRACT_ELIMINATED based on the accepted offer
    const taxDemand = acceptedOffer.demands.find((d) => d.kind === 'change_contract_tax_rate')
    if (taxDemand && taxDemand.kind === 'change_contract_tax_rate') {
      const isElimination = isContractEliminationRate(taxDemand.newTaxRateToGrantor, nextCtx.config)
      const initiatorRef = getPolityNameRefForEmit(nextCtx.state, initiatorPolityId)
      const defenderRef = getPolityNameRefForEmit(nextCtx.state, defenderPolityId)
      const initiatorName = initiatorRef.nameKey
      const defenderName = defenderRef.nameKey
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
          initiator: nameParam(initiatorRef.category, initiatorName),
          defender: nameParam(defenderRef.category, defenderName),
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
          getPolityEmitNameKey(nextCtx.state, initiatorPolityId),
        ),
        entityRef(
          'polity',
          defenderPolityId,
          'defender',
          getPolityEmitNameKey(nextCtx.state, defenderPolityId),
        ),
      ],
    })
    return { ...ctxSettled, events: [...ctxSettled.events, settledEvent] }
  }

  // Escalation check
  if (nextTension >= config.diplomaticPlayEscalationThreshold) {
    const initiatorRef = getPolityNameRefForEmit(nextCtx.state, initiatorPolityId)
    const defenderRef = getPolityNameRefForEmit(nextCtx.state, defenderPolityId)
    const initiatorName = initiatorRef.nameKey
    const defenderName = defenderRef.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `${initiatorName} demands tax changes from ${defenderName} over ${provinceNameKey}.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam(initiatorRef.category, initiatorName),
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
    const initiatorRef = getPolityNameRefForEmit(nextCtx.state, initiatorPolityId)
    const defenderRef = getPolityNameRefForEmit(nextCtx.state, defenderPolityId)
    const initiatorName = initiatorRef.nameKey
    const defenderName = defenderRef.nameKey
    const provinceNameKey = nextCtx.state.provinces[provinceId]?.nameKey ?? provinceId
    return markPlayEscalated(nextCtx, play.id, {
      polityIds: [initiatorPolityId, defenderPolityId],
      provinceIds: [provinceId],
      holdingIds: [holdingId],
      summary: `Tax revision dispute over ${provinceNameKey} escalates to conflict.`,
      messageKey: 'diplomatic_play.escalated_claim',
      messageParams: {
        initiator: nameParam(initiatorRef.category, initiatorName),
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
