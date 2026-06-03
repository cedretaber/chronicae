import type { WorldState } from '../types/world'
import type {
  DiplomaticPlay,
  DiplomaticDemand,
  ContractTaxRevisionIssue,
} from '../types/diplomaticPlay'
import type { OrganizationRef } from '../types/office'
import type { HoldingId, LandContractId, PolityId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import { clamp } from '../utils/math'
import { createDiplomaticOfferMut } from '../mutations/diplomaticOfferMutations'
import { computeLandClaimCompensation } from './diplomaticOfferEvaluation'

// --- v0.30: Compromise offer builder ---

const COMPROMISE_ADJUSTMENT = 0.3

export function buildAndCreateCompromiseOffer(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
): void {
  // revolt_negotiation plays do not use the offer system
  if (play.kind === 'revolt_negotiation') return
  // Only polity actors can create offers
  if (play.initiator.kind !== 'polity' || play.target.kind !== 'polity') return

  // Determine base offer: lastRejectedOffer > currentOffer > build from issue
  const baseOfferId = play.lastRejectedOfferId ?? play.currentOfferId
  const baseOffer = baseOfferId ? ws.diplomaticOffers[baseOfferId] : undefined
  const baseDemands: DiplomaticDemand[] | undefined = baseOffer?.demands

  const proposedBy: OrganizationRef = side === 'initiator' ? play.initiator : play.target

  let adjustedDemands: DiplomaticDemand[] | undefined

  if (play.kind === 'land_claim') {
    adjustedDemands = buildLandClaimCompromiseDemands(ws, config, play, side, baseDemands)
  } else if (play.kind === 'contract_tax_revision') {
    adjustedDemands = buildTaxRevisionCompromiseDemands(ws, config, play, baseDemands)
  }

  if (!adjustedDemands || adjustedDemands.length === 0) return

  createDiplomaticOfferMut(ws, play.id, proposedBy, adjustedDemands, [])
}

function buildLandClaimCompromiseDemands(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
  baseDemands: DiplomaticDemand[] | undefined,
): DiplomaticDemand[] | undefined {
  if (!play.issue || play.issue.kind !== 'land_claim') return undefined
  const holdingId = play.issue.holdingId

  if (baseDemands) {
    return adjustLandClaimDemands(ws, config, play, side, baseDemands, holdingId)
  }

  // No base offer — create a default: transfer + pay using computeLandClaimCompensation
  const compensation = computeLandClaimCompensation(ws, config, holdingId)
  const demands: DiplomaticDemand[] = [
    {
      kind: 'transfer_land_contract',
      holdingId,
      toPolityId: play.initiator.id as PolityId,
    },
    {
      kind: 'pay_wealth',
      from: play.initiator,
      to: play.target,
      amount: Math.round(compensation),
    },
  ]
  return demands
}

function adjustLandClaimDemands(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
  baseDemands: DiplomaticDemand[],
  holdingId: HoldingId,
): DiplomaticDemand[] {
  // Detect whether the base offer is a status_quo offer or a transfer offer.
  // This determines how pay_wealth adjustment works for the target side:
  //   - transfer offer: pay_wealth flows initiator→target (land price); target compromise = decrease
  //   - status_quo offer: pay_wealth flows target→initiator (compensation); target compromise = increase
  const isStatusQuoOffer = baseDemands.some((d) => d.kind === 'status_quo')

  const result: DiplomaticDemand[] = []
  let hasPayWealth = false

  for (const demand of baseDemands) {
    if (demand.kind === 'pay_wealth') {
      hasPayWealth = true
      if (side === 'initiator') {
        // Initiator compromising toward target: increase pay_wealth by 30%
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 + COMPROMISE_ADJUSTMENT)),
        })
      } else if (isStatusQuoOffer) {
        // Target compromising on status_quo: increase compensation by 30%
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 + COMPROMISE_ADJUSTMENT)),
        })
      } else {
        // Target compromising on transfer: decrease pay_wealth by 30% (cheaper for initiator)
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 - COMPROMISE_ADJUSTMENT)),
        })
      }
    } else {
      result.push(demand)
    }
  }

  // If side === 'initiator' and no pay_wealth existed, add one based on compensation
  if (side === 'initiator' && !hasPayWealth) {
    const compensation = computeLandClaimCompensation(ws, config, holdingId)
    result.push({
      kind: 'pay_wealth',
      from: play.initiator,
      to: play.target,
      amount: Math.round(compensation * (1 + COMPROMISE_ADJUSTMENT)),
    })
  }

  return result
}

function buildTaxRevisionCompromiseDemands(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  baseDemands: DiplomaticDemand[] | undefined,
): DiplomaticDemand[] | undefined {
  if (!play.issue || play.issue.kind !== 'contract_tax_revision') return undefined
  const issue = play.issue
  const holdingId = issue.holdingId
  const landContractId = issue.landContractId
  const baseTaxRate = issue.baseTaxRateToGrantor

  if (baseDemands) {
    return adjustTaxRevisionDemands(
      ws,
      config,
      play,
      baseDemands,
      holdingId,
      landContractId,
      baseTaxRate,
      issue,
    )
  }

  // No base offer — create default: change_contract_tax_rate with rate halfway between base and desired
  const desiredRate = issue.desiredTaxRateToGrantor
  const halfwayRate = clamp(
    (baseTaxRate + desiredRate) / 2,
    config.taxRevisionMinRate,
    config.taxRevisionMaxRate,
  )
  const demands: DiplomaticDemand[] = [
    {
      kind: 'change_contract_tax_rate',
      holdingId,
      landContractId,
      newTaxRateToGrantor: halfwayRate,
    },
  ]
  return demands
}

function adjustTaxRevisionDemands(
  _ws: WorldState,
  config: SimulationConfig,
  _play: DiplomaticPlay,
  baseDemands: DiplomaticDemand[],
  holdingId: HoldingId,
  landContractId: LandContractId,
  baseTaxRate: number,
  issue: ContractTaxRevisionIssue | undefined,
): DiplomaticDemand[] {
  const result: DiplomaticDemand[] = []
  let hasTaxChange = false

  for (const demand of baseDemands) {
    if (demand.kind === 'change_contract_tax_rate') {
      hasTaxChange = true
      // Move newTaxRateToGrantor 30% toward baseTaxRate (compromise toward status quo)
      const currentRate = demand.newTaxRateToGrantor
      const compromiseRate = clamp(
        currentRate + (baseTaxRate - currentRate) * COMPROMISE_ADJUSTMENT,
        config.taxRevisionMinRate,
        config.taxRevisionMaxRate,
      )
      result.push({
        ...demand,
        newTaxRateToGrantor: compromiseRate,
      })
    } else {
      result.push(demand)
    }
  }

  // If no change_contract_tax_rate in base demands (e.g., status_quo offer),
  // create one with halfway rate
  if (!hasTaxChange) {
    const desiredRate = issue?.desiredTaxRateToGrantor ?? baseTaxRate
    const halfwayRate = clamp(
      (baseTaxRate + desiredRate) / 2,
      config.taxRevisionMinRate,
      config.taxRevisionMaxRate,
    )
    // Replace status_quo with tax change demand
    const nonStatusQuo = result.filter((d) => d.kind !== 'status_quo')
    nonStatusQuo.push({
      kind: 'change_contract_tax_rate',
      holdingId,
      landContractId,
      newTaxRateToGrantor: halfwayRate,
    })
    return nonStatusQuo
  }

  return result
}
