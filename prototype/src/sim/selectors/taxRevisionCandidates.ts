import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, ProvinceId, LandContractId } from '../types/ids'
import { calcPolityMilitaryPower } from './militarySelectors'

export type TaxRevisionCandidate = {
  initiatorPolityId: PolityId
  targetPolityId: PolityId
  provinceId: ProvinceId
  contractId: LandContractId
  currentRate: number
  intentPriority: number
}

export function findTaxReductionCandidates(
  state: WorldState,
  config: SimulationConfig,
): TaxRevisionCandidate[] {
  if (!config.taxRevisionIntentEnabled) return []

  const candidates: TaxRevisionCandidate[] = []

  for (const polityIdStr of Object.keys(state.polities).sort()) {
    const polity = state.polities[polityIdStr as PolityId]
    if (!polity || !polity.active || polity.ownerHouseId === undefined) continue

    const polityId = polityIdStr as PolityId

    // Skip if treasury below minimum
    if (polity.treasury < config.taxRevisionMinTreasury) continue

    // Skip if war cooldown not passed
    if (
      polity.lastWarWeek !== undefined &&
      state.absoluteWeek - polity.lastWarWeek < config.warCooldownWeeks
    ) {
      continue
    }

    const initiatorPower = calcPolityMilitaryPower(state, config, polityId)

    // Get contracts where this polity is grantee
    const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
    for (const contractId of contractIds) {
      const contract = state.landContracts[contractId]
      if (!contract) continue

      // Skip root contracts (no parent)
      if (contract.parentContractId === undefined) continue

      // Only consider if tax rate is above minimum threshold
      if (contract.terms.taxRateToGrantor <= config.taxRevisionMinRateForReduction) continue

      // Find parent contract
      const parentContract = state.landContracts[contract.parentContractId]
      if (!parentContract) continue

      // The grantor polity is the parent's grantee
      const grantorPolityId = parentContract.granteePolityId
      const grantorPolity = state.polities[grantorPolityId]
      if (!grantorPolity || !grantorPolity.active || grantorPolity.ownerHouseId === undefined)
        continue

      const grantorPower = calcPolityMilitaryPower(state, config, grantorPolityId)
      const militaryAdvantage = (initiatorPower / (initiatorPower + grantorPower + 1)) * 50

      const intentPriority =
        (contract.terms.taxRateToGrantor - config.taxRevisionMinRateForReduction) * 100 +
        militaryAdvantage

      candidates.push({
        initiatorPolityId: polityId,
        targetPolityId: grantorPolityId,
        provinceId: contract.provinceId,
        contractId: contract.id,
        currentRate: contract.terms.taxRateToGrantor,
        intentPriority,
      })
    }
  }

  // Sort by priority desc, limit per polity
  candidates.sort((a, b) => b.intentPriority - a.intentPriority)

  const result: TaxRevisionCandidate[] = []
  const polityCounts = new Map<PolityId, number>()

  for (const c of candidates) {
    const count = polityCounts.get(c.initiatorPolityId) ?? 0
    if (count >= config.taxRevisionMaxIntentsPerActor) continue
    polityCounts.set(c.initiatorPolityId, count + 1)
    result.push(c)
  }

  return result
}

export function findTaxIncreaseCandidates(
  state: WorldState,
  config: SimulationConfig,
): TaxRevisionCandidate[] {
  if (!config.taxRevisionIntentEnabled) return []

  const candidates: TaxRevisionCandidate[] = []

  for (const polityIdStr of Object.keys(state.polities).sort()) {
    const polity = state.polities[polityIdStr as PolityId]
    if (!polity || !polity.active || polity.ownerHouseId === undefined) continue

    const polityId = polityIdStr as PolityId

    // Skip if treasury below minimum
    if (polity.treasury < config.taxRevisionMinTreasury) continue

    // Skip if war cooldown not passed
    if (
      polity.lastWarWeek !== undefined &&
      state.absoluteWeek - polity.lastWarWeek < config.warCooldownWeeks
    ) {
      continue
    }

    const initiatorPower = calcPolityMilitaryPower(state, config, polityId)

    // Get ALL contracts where this polity is grantee
    const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
    for (const contractId of contractIds) {
      const contract = state.landContracts[contractId]
      if (!contract) continue

      // Find child contract via byParent
      const childContractId = state.landContractIndex.byParent[contract.id]
      if (childContractId === undefined) continue

      const child = state.landContracts[childContractId]
      if (!child) continue

      // Only consider if child tax rate is below maximum threshold
      if (child.terms.taxRateToGrantor >= config.taxRevisionMaxRateForIncrease) continue

      // The target is the child's grantee
      const targetPolityId = child.granteePolityId
      const targetPolity = state.polities[targetPolityId]
      if (!targetPolity || !targetPolity.active || targetPolity.ownerHouseId === undefined) continue

      const targetPower = calcPolityMilitaryPower(state, config, targetPolityId)
      const militaryAdvantage = (initiatorPower / (initiatorPower + targetPower + 1)) * 50

      const intentPriority =
        (config.taxRevisionMaxRateForIncrease - child.terms.taxRateToGrantor) * 100 +
        militaryAdvantage

      candidates.push({
        initiatorPolityId: polityId,
        targetPolityId: targetPolityId,
        provinceId: child.provinceId,
        contractId: child.id,
        currentRate: child.terms.taxRateToGrantor,
        intentPriority,
      })
    }
  }

  // Sort by priority desc, limit per polity
  candidates.sort((a, b) => b.intentPriority - a.intentPriority)

  const result: TaxRevisionCandidate[] = []
  const polityCounts = new Map<PolityId, number>()

  for (const c of candidates) {
    const count = polityCounts.get(c.initiatorPolityId) ?? 0
    if (count >= config.taxRevisionMaxIntentsPerActor) continue
    polityCounts.set(c.initiatorPolityId, count + 1)
    result.push(c)
  }

  return result
}
