// v0.30 Phase A: Pure functions for validating and evaluating diplomatic offers.
// Not wired into the main loop yet — will be connected in Phase B.

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, PolityId } from '../types/ids'
import type {
  DiplomaticPlay,
  DiplomaticOffer,
  DiplomaticDemand,
  OfferValidationResult,
  OfferEvaluation,
  ContractTaxRevisionIssue,
} from '../types/diplomaticPlay'
import type { OrganizationRef } from '../types/office'
import { isSameActor } from '../selectors/actorSelectors'
import { getActorMilitaryPower } from '../selectors/actorSelectors'
import { calcGeneralWarPowerModifier } from '../selectors/personAbilityEffects'
import { getProvinceDevelopmentFromHoldings } from '../selectors/landContractSelectors'
import {
  computeDefenderTreasuryNeed,
  computeProvinceValue,
  computeStrategicValue,
  computePrestigeLoss,
} from './diplomaticPlaySystem'

// ─── Extracted offer parameter types ───

type LandClaimOfferParams = {
  transferHoldingId?: HoldingId
  toPolityId?: PolityId
  offeredPrice: number
  statusQuo: boolean
}

type ContractTaxRevisionOfferParams = {
  newTaxRateToGrantor?: number
  paymentAmount: number
  statusQuo: boolean
}

// ─── Validation ───

export function validateOffer(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  offer: DiplomaticOffer,
): OfferValidationResult {
  if (offer.playId !== play.id) return { valid: false, reason: 'wrong_play' }
  if (offer.status !== 'pending') return { valid: false, reason: 'offer_not_pending' }

  if (
    !isSameActor(offer.proposedBy, play.initiator) &&
    !isSameActor(offer.proposedBy, play.target)
  ) {
    return { valid: false, reason: 'missing_actor' }
  }

  if (offer.demands.length === 0) return { valid: false, reason: 'invalid_demand' }

  // Per-demand validation
  for (const demand of offer.demands) {
    const result = canApplyDemand(state, config, demand)
    if (!result.valid) return result
  }

  // Check unsupported combinations: both transfer_land_contract AND change_contract_tax_rate
  const hasTransfer = offer.demands.some((d) => d.kind === 'transfer_land_contract')
  const hasTaxChange = offer.demands.some((d) => d.kind === 'change_contract_tax_rate')
  if (hasTransfer && hasTaxChange) {
    return { valid: false, reason: 'unsupported_demand_combination' }
  }

  // Issue-demand consistency checks
  if (play.kind === 'land_claim') {
    if (hasTaxChange) return { valid: false, reason: 'unsupported_demand_combination' }
    if (play.issue?.kind === 'land_claim') {
      for (const demand of offer.demands) {
        if (demand.kind === 'transfer_land_contract') {
          if (demand.holdingId !== play.issue.holdingId) {
            return { valid: false, reason: 'invalid_demand' }
          }
        }
      }
    }
  }

  if (play.kind === 'contract_tax_revision') {
    if (hasTransfer) return { valid: false, reason: 'unsupported_demand_combination' }
    if (play.issue?.kind === 'contract_tax_revision') {
      for (const demand of offer.demands) {
        if (demand.kind === 'change_contract_tax_rate') {
          if (demand.landContractId !== play.issue.landContractId) {
            return { valid: false, reason: 'invalid_demand' }
          }
        }
      }
    }
  }

  return { valid: true }
}

function canApplyDemand(
  state: WorldState,
  config: SimulationConfig,
  demand: DiplomaticDemand,
): OfferValidationResult {
  switch (demand.kind) {
    case 'transfer_land_contract': {
      if (!state.holdings[demand.holdingId]) return { valid: false, reason: 'missing_holding' }
      const toPolity = state.polities[demand.toPolityId]
      if (!toPolity?.active) return { valid: false, reason: 'missing_actor' }
      return { valid: true }
    }

    case 'change_contract_tax_rate': {
      const contract = state.landContracts[demand.landContractId]
      if (!contract) return { valid: false, reason: 'missing_land_contract' }
      // Verify contract belongs to the holding's chain
      const holdingChain = state.landContractIndex.byHolding[demand.holdingId] ?? []
      if (!holdingChain.includes(demand.landContractId)) {
        return { valid: false, reason: 'stale_land_contract' }
      }
      if (
        demand.newTaxRateToGrantor < config.taxRevisionMinRate ||
        demand.newTaxRateToGrantor > config.taxRevisionMaxRate
      ) {
        return { valid: false, reason: 'invalid_demand' }
      }
      return { valid: true }
    }

    case 'pay_wealth': {
      // Verify actors exist
      if (demand.from.kind === 'polity') {
        const polity = state.polities[demand.from.id]
        if (!polity?.active) return { valid: false, reason: 'missing_actor' }
        if (polity.treasury < demand.amount) return { valid: false, reason: 'insufficient_funds' }
      } else {
        const house = state.houses[demand.from.id]
        if (!house) return { valid: false, reason: 'missing_actor' }
        if (house.wealth < demand.amount) return { valid: false, reason: 'insufficient_funds' }
      }
      if (demand.to.kind === 'polity') {
        const polity = state.polities[demand.to.id]
        if (!polity?.active) return { valid: false, reason: 'missing_actor' }
      } else {
        const house = state.houses[demand.to.id]
        if (!house) return { valid: false, reason: 'missing_actor' }
      }
      return { valid: true }
    }

    case 'status_quo':
      return { valid: true }

    case 'popular_tax_relief':
      return { valid: true }

    case 'bailiff_dismissal':
      return { valid: true }

    case 'secession':
      return { valid: true }
  }
}

// ─── Evaluator resolution ───

export function getOfferEvaluator(play: DiplomaticPlay, offer: DiplomaticOffer): OrganizationRef {
  if (isSameActor(offer.proposedBy, play.initiator)) {
    return play.target
  }
  return play.initiator
}

// ─── Parameter extraction ───

function extractLandClaimOfferParams(offer: DiplomaticOffer): LandClaimOfferParams {
  const result: LandClaimOfferParams = { offeredPrice: 0, statusQuo: false }

  for (const demand of offer.demands) {
    if (demand.kind === 'transfer_land_contract') {
      result.transferHoldingId = demand.holdingId
      result.toPolityId = demand.toPolityId
    } else if (demand.kind === 'pay_wealth') {
      result.offeredPrice = demand.amount
    } else if (demand.kind === 'status_quo') {
      result.statusQuo = true
    }
  }

  return result
}

function extractContractTaxRevisionOfferParams(
  offer: DiplomaticOffer,
): ContractTaxRevisionOfferParams {
  const result: ContractTaxRevisionOfferParams = { paymentAmount: 0, statusQuo: false }

  for (const demand of offer.demands) {
    if (demand.kind === 'change_contract_tax_rate') {
      result.newTaxRateToGrantor = demand.newTaxRateToGrantor
    } else if (demand.kind === 'pay_wealth') {
      result.paymentAmount = demand.amount
    } else if (demand.kind === 'status_quo') {
      result.statusQuo = true
    }
  }

  return result
}

// ─── Compensation computation ───

export function computeLandClaimCompensation(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const holding = state.holdings[holdingId]
  if (!holding) return 0
  const provinceId = holding.provinceId
  const development = getProvinceDevelopmentFromHoldings(state, provinceId, config)
  return Math.max(
    config.purchasePriceBase,
    config.purchasePriceBase + development * config.purchasePriceDevelopmentFactor,
  )
}

export function computeTaxRevisionCompensation(
  state: WorldState,
  config: SimulationConfig,
  issue: ContractTaxRevisionIssue,
  newTaxRateToGrantor: number,
): number {
  const provinceId = state.holdings[issue.holdingId]?.provinceId
  if (!provinceId) return 0
  const taxBase = getProvinceDevelopmentFromHoldings(state, provinceId, config)
  const annualDelta = taxBase * Math.abs(newTaxRateToGrantor - issue.baseTaxRateToGrantor)
  return Math.round(annualDelta * config.taxRevisionCompensationYears)
}

// ─── Evaluation dispatch ───

export function evaluateOffer(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  offer: DiplomaticOffer,
  evaluator: OrganizationRef,
): OfferEvaluation {
  switch (play.kind) {
    case 'land_claim':
      return evaluateLandClaimOffer(state, config, play, offer, evaluator)
    case 'contract_tax_revision':
      return evaluateContractTaxRevisionOffer(state, config, play, offer, evaluator)
    default:
      return {
        accepted: false,
        score: -100,
        progressDelta: 0,
        tensionDelta: config.rejectedOfferTensionDelta,
        reasonKey: 'unsupported_play_kind',
      }
  }
}

function getEvaluatorNegotiationBonus(play: DiplomaticPlay, evaluator: OrganizationRef): number {
  const isInitiator = isSameActor(evaluator, play.initiator)
  const prep = isInitiator ? play.initiatorPreparation : play.targetPreparation
  const lev = isInitiator ? play.initiatorLeverage : play.targetLeverage
  const commit = isInitiator ? play.initiatorCommitment : play.targetCommitment
  return prep * 0.05 + lev * 0.1 + commit * 0.1
}

// ─── Land claim evaluation (mirrors progressLandClaim formula) ───

function evaluateLandClaimOffer(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  offer: DiplomaticOffer,
  evaluator: OrganizationRef,
): OfferEvaluation {
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') {
    return {
      accepted: false,
      score: -100,
      progressDelta: 0,
      tensionDelta: config.rejectedOfferTensionDelta,
      reasonKey: 'invalid_actor_kind',
    }
  }

  let holdingId: HoldingId | undefined
  if (play.issue?.kind === 'land_claim') {
    holdingId = play.issue.holdingId
  }
  if (!holdingId) {
    holdingId = extractLandClaimOfferParams(offer).transferHoldingId
  }
  if (!holdingId) {
    return {
      accepted: false,
      score: -100,
      progressDelta: 0,
      tensionDelta: config.rejectedOfferTensionDelta,
      reasonKey: 'missing_holding',
    }
  }

  const provinceId = state.holdings[holdingId]?.provinceId
  if (!provinceId) {
    return {
      accepted: false,
      score: -100,
      progressDelta: 0,
      tensionDelta: config.rejectedOfferTensionDelta,
      reasonKey: 'missing_province',
    }
  }

  const params = extractLandClaimOfferParams(offer)
  const evaluatorIsInitiator = isSameActor(evaluator, play.initiator)

  const selfActor = evaluatorIsInitiator ? play.initiator : play.target
  const opponentActor = evaluatorIsInitiator ? play.target : play.initiator
  const selfPolity = state.polities[selfActor.id]
  if (!selfPolity?.active) {
    return {
      accepted: false,
      score: -100,
      progressDelta: 0,
      tensionDelta: config.rejectedOfferTensionDelta,
      reasonKey: 'missing_defender',
    }
  }

  const selfTreasuryNeed = computeDefenderTreasuryNeed(selfPolity.treasury)
  const opponentPower =
    getActorMilitaryPower(state, config, opponentActor) *
    calcGeneralWarPowerModifier(state, opponentActor.id, config)
  const selfPower =
    getActorMilitaryPower(state, config, selfActor) *
    calcGeneralWarPowerModifier(state, selfActor.id, config)
  const provinceValue = computeProvinceValue(
    getProvinceDevelopmentFromHoldings(state, provinceId, config),
  )
  const strategicLoss = computeStrategicValue(state, provinceId, selfActor.id)
  const prestigeLoss = computePrestigeLoss(selfPolity.rank)
  const negotiationBonus = getEvaluatorNegotiationBonus(play, evaluator)

  const score =
    params.offeredPrice * config.claimOfferedPriceFactor +
    selfTreasuryNeed +
    opponentPower * config.claimInitiatorPressureFactor -
    selfPower * config.claimDefenderResistFactor -
    provinceValue * config.claimProvinceValueFactor -
    strategicLoss * config.claimStrategicLossFactor -
    prestigeLoss * config.claimPrestigeLossFactor +
    negotiationBonus

  if (score >= 0) {
    return {
      accepted: true,
      score,
      progressDelta: 0,
      tensionDelta: 0,
      reasonKey: 'offer_accepted',
    }
  }
  return {
    accepted: false,
    score,
    progressDelta: 2,
    tensionDelta: config.rejectedOfferTensionDelta,
    reasonKey: 'offer_rejected_insufficient_value',
  }
}

// ─── Contract tax revision evaluation (mirrors progressContractTaxRevision formula) ───

function evaluateContractTaxRevisionOffer(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  offer: DiplomaticOffer,
  evaluator: OrganizationRef,
): OfferEvaluation {
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') {
    return {
      accepted: false,
      score: -100,
      progressDelta: 0,
      tensionDelta: config.rejectedOfferTensionDelta,
      reasonKey: 'invalid_actor_kind',
    }
  }

  const holdingId = play.issue?.kind === 'contract_tax_revision' ? play.issue.holdingId : undefined
  if (!holdingId) {
    return {
      accepted: false,
      score: -100,
      progressDelta: 0,
      tensionDelta: config.rejectedOfferTensionDelta,
      reasonKey: 'missing_holding',
    }
  }

  const provinceId = state.holdings[holdingId]?.provinceId
  if (!provinceId) {
    return {
      accepted: false,
      score: -100,
      progressDelta: 0,
      tensionDelta: config.rejectedOfferTensionDelta,
      reasonKey: 'missing_province',
    }
  }

  const params = extractContractTaxRevisionOfferParams(offer)

  const currentRate =
    play.issue?.kind === 'contract_tax_revision' ? play.issue.baseTaxRateToGrantor : 0.3

  const newRate = params.newTaxRateToGrantor ?? currentRate
  const isReduction = newRate < currentRate
  const evaluatorIsInitiator = isSameActor(evaluator, play.initiator)

  const opponentActor = evaluatorIsInitiator ? play.target : play.initiator
  const selfActor = evaluatorIsInitiator ? play.initiator : play.target

  const opponentPower =
    getActorMilitaryPower(state, config, opponentActor) *
    calcGeneralWarPowerModifier(state, opponentActor.id, config)
  const selfPower =
    getActorMilitaryPower(state, config, selfActor) *
    calcGeneralWarPowerModifier(state, selfActor.id, config)

  const rateImbalance = isReduction
    ? (currentRate - 0.3) * config.taxRevisionRateImbalanceFactor
    : (0.5 - currentRate) * config.taxRevisionRateImbalanceFactor

  const provinceValue = computeProvinceValue(
    getProvinceDevelopmentFromHoldings(state, provinceId, config),
  )

  const negotiationBonus = getEvaluatorNegotiationBonus(play, evaluator)

  const score =
    opponentPower * config.taxRevisionPressureFactor -
    selfPower * config.taxRevisionResistFactor +
    rateImbalance -
    provinceValue * config.taxRevisionProvinceValueFactor +
    params.paymentAmount * 0.01 +
    negotiationBonus

  if (score >= 0) {
    return {
      accepted: true,
      score,
      progressDelta: 0,
      tensionDelta: 0,
      reasonKey: 'offer_accepted',
    }
  }
  return {
    accepted: false,
    score,
    progressDelta: 2,
    tensionDelta: config.rejectedOfferTensionDelta,
    reasonKey: 'offer_rejected_insufficient_value',
  }
}
