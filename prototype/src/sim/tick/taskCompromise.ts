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

// v0.42: 提案側 (proposer) の交渉担当者の能力で譲歩幅をスケールする。
//   巧い交渉者 (charisma/insight 高) ほど譲歩幅が小さく、理想に近い額を要求する
//   = 呑まれれば好条件。受諾スコア (evaluateOffer) には触れないので二重計上にならない
//   (能力は別経路で task 成功 → prep/leverage/commitment にも効いている)。
//   personAbilityEffectsEnabled OFF 時は基準値 (0.3) に戻る。
function negotiatorCompromiseAdjustment(
  state: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  side: 'initiator' | 'target',
): number {
  if (!config.personAbilityEffectsEnabled) return COMPROMISE_ADJUSTMENT
  const delegateId =
    side === 'initiator' ? play.initiatorDelegatePersonId : play.targetDelegatePersonId
  const person = delegateId ? state.persons[delegateId] : undefined
  if (!person || !person.alive) return COMPROMISE_ADJUSTMENT
  // abilities は 0..120 (中点 60)。charisma/insight 平均を [-1,1] に正規化。
  const skill = (person.abilities.charisma + person.abilities.insight) / 2
  const skillNorm = (skill - 60) / 60
  // 巧い交渉者ほど譲歩幅を縮める。effect=0.1 で ±10% に収まる穏やかな効果。
  return COMPROMISE_ADJUSTMENT * (1 - skillNorm * config.negotiatorTermQualityEffect)
}

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

  // v0.42: 提案側の交渉能力で譲歩幅を決定 (OFF 時は基準 0.3)。
  const adjustment = negotiatorCompromiseAdjustment(ws, config, play, side)

  let adjustedDemands: DiplomaticDemand[] | undefined

  if (play.kind === 'land_claim') {
    adjustedDemands = buildLandClaimCompromiseDemands(
      ws,
      config,
      play,
      side,
      baseDemands,
      adjustment,
    )
  } else if (play.kind === 'contract_tax_revision') {
    adjustedDemands = buildTaxRevisionCompromiseDemands(ws, config, play, baseDemands, adjustment)
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
  adjustment: number,
): DiplomaticDemand[] | undefined {
  if (!play.issue || play.issue.kind !== 'land_claim') return undefined
  const holdingId = play.issue.holdingId

  if (baseDemands) {
    return adjustLandClaimDemands(ws, config, play, side, baseDemands, holdingId, adjustment)
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
  adjustment: number,
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
        // Initiator compromising toward target: increase pay_wealth (巧い交渉者ほど幅は小さい)
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 + adjustment)),
        })
      } else if (isStatusQuoOffer) {
        // Target compromising on status_quo: increase compensation
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 + adjustment)),
        })
      } else {
        // Target compromising on transfer: decrease pay_wealth (cheaper for initiator)
        result.push({
          ...demand,
          amount: Math.round(demand.amount * (1 - adjustment)),
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
      amount: Math.round(compensation * (1 + adjustment)),
    })
  }

  return result
}

function buildTaxRevisionCompromiseDemands(
  ws: WorldState,
  config: SimulationConfig,
  play: DiplomaticPlay,
  baseDemands: DiplomaticDemand[] | undefined,
  adjustment: number,
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
      adjustment,
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
  adjustment: number,
): DiplomaticDemand[] {
  const result: DiplomaticDemand[] = []
  let hasTaxChange = false

  for (const demand of baseDemands) {
    if (demand.kind === 'change_contract_tax_rate') {
      hasTaxChange = true
      // Move newTaxRateToGrantor toward baseTaxRate (compromise toward status quo)。
      //   巧い交渉者ほど adjustment が小さく、理想 (currentRate) に近い額で押す。
      const currentRate = demand.newTaxRateToGrantor
      const compromiseRate = clamp(
        currentRate + (baseTaxRate - currentRate) * adjustment,
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
