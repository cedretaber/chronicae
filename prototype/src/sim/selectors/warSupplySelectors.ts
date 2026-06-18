import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId, PolityId, ProvinceId } from '../types/ids'
import type { SupplyShortageBand } from '../types/war'
import type { Regiment } from '../types/regiment'
import { getRoleScore } from './abilitySelectors'
import type { AppliedRoleKey } from './abilitySelectors'
import { isEligibleWarPerson } from './warManeuverSelectors'
import { getPolityWarCandidatePersonIds } from './warManeuverSelectors'
import { getProvinceAveragePopWealth } from './popSelectors'
import {
  getProvinceDevelopmentFromHoldings,
  getProvincePolityControlFromHoldings,
  getHoldingTerminalPolityId,
} from './landContractSelectors'
import { isRoleEligibleBySex } from './roleEligibilitySelectors'
import { clamp } from '../utils/math'

// --- terrain modifiers ---

const TERRAIN_SUPPLY_ACCESS_MODIFIER: Record<string, number> = {
  plains: 5,
  hills: 0,
  forest: -5,
  mountains: -10,
  wetlands: -5,
}

const TERRAIN_FORAGE_MODIFIER: Record<string, number> = {
  plains: 0.05,
  hills: 0,
  forest: -0.05,
  mountains: -0.1,
  wetlands: -0.05,
}

// --- staff selection ---

// Select a staff member (strategist or quartermaster) for a war side.
// Uses the same candidate pool as captainGeneral (getPolityWarCandidatePersonIds)
// but scores by a different role (strategy for strategist, stewardship for quartermaster).
// Excludes the captainGeneral and any persons in the exclude set.
export function selectWarStaffForSide(
  state: WorldState,
  config: SimulationConfig,
  polityIds: readonly PolityId[],
  role: AppliedRoleKey,
  captainGeneralId: PersonId | undefined,
  exclude?: ReadonlySet<string>,
): PersonId | undefined {
  let bestId: PersonId | undefined
  let bestScore = -Infinity
  const seen = new Set<string>()

  for (const polityId of polityIds) {
    for (const personId of getPolityWarCandidatePersonIds(state, polityId)) {
      if (seen.has(personId)) continue
      seen.add(personId)
      if (captainGeneralId !== undefined && personId === captainGeneralId) continue
      if (exclude?.has(personId)) continue
      if (!isEligibleWarPerson(state, personId)) continue
      if (!isRoleEligibleBySex(state, config, personId)) continue
      const score = getRoleScore(state, personId, role)
      if (score > bestScore) {
        bestScore = score
        bestId = personId
      }
    }
  }
  return bestId
}

// --- supply computations ---

// Check if the war province is friendly territory for this side
function isFriendlyTerritory(
  state: WorldState,
  provinceId: ProvinceId,
  sidePolityIds: readonly PolityId[],
): boolean {
  const province = state.provinces[provinceId]
  if (!province) return false
  const politySet = new Set<string>(sidePolityIds)
  for (const holdingId of province.holdingIds) {
    const terminal = getHoldingTerminalPolityId(state, holdingId)
    if (terminal !== undefined && politySet.has(terminal)) return true
  }
  return false
}

// Count active crises in a province
function countActiveProvinceCrises(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let count = 0
  for (const holdingId of province.holdingIds) {
    const crisisIds = state.crisisIndex.byHolding[holdingId]
    if (!crisisIds) continue
    for (const crisisId of crisisIds) {
      const crisis = state.crises[crisisId]
      if (crisis && crisis.status === 'active') count++
    }
  }
  return count
}

// Compute supplyAccess (recomputed from zero each week). Spec §8.
export function computeSupplyAccess(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
  prevLocalHostility: number,
  qmScore: number,
  stratScore: number,
  sidePolityIds: readonly PolityId[],
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  const terrainMod = TERRAIN_SUPPLY_ACCESS_MODIFIER[province.terrain] ?? 0
  const friendly = isFriendlyTerritory(state, provinceId, sidePolityIds)
  const friendlyBonus = friendly ? 10 : 0
  const activeCrisisCount = countActiveProvinceCrises(state, provinceId)

  const raw =
    config.warSupplyAccessBase +
    getProvinceAveragePopWealth(state, provinceId) * config.warSupplyAccessWealthFactor +
    getProvinceDevelopmentFromHoldings(state, provinceId, config) *
      config.warSupplyAccessDevelopmentFactor +
    getProvincePolityControlFromHoldings(state, provinceId) * config.warSupplyAccessControlFactor +
    terrainMod +
    friendlyBonus -
    prevLocalHostility * config.warSupplyAccessHostilityPenaltyFactor -
    activeCrisisCount * config.warSupplyAccessCrisisPenalty +
    (qmScore / 100) * config.warSupplyQuartermasterAccessFactor +
    (stratScore / 100) * config.warSupplyStrategistAccessFactor

  return clamp(raw, 0, 150)
}

// Compute forageEfficiency (recomputed from zero each week). Spec §10.
export function computeForageEfficiency(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
  prevLocalHostility: number,
  qmScore: number,
  stratScore: number,
  cgCommandScore: number,
  cavalryRatio: number,
  sidePolityIds: readonly PolityId[],
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0.1

  const terrainMod = TERRAIN_FORAGE_MODIFIER[province.terrain] ?? 0
  const friendly = isFriendlyTerritory(state, provinceId, sidePolityIds)
  const friendlyBonus = friendly ? 0.1 : 0
  const polityControl = getProvincePolityControlFromHoldings(state, provinceId)
  const polityControlBonus = (polityControl / 100) * 0.1
  const development = getProvinceDevelopmentFromHoldings(state, provinceId, config)
  const devBonus = clamp(development / 20, 0, 0.1)
  const activeCrisisCount = countActiveProvinceCrises(state, provinceId)
  const crisisPenalty = activeCrisisCount * 0.03

  const raw =
    config.warSupplyForageBase +
    (qmScore / 100) * config.warSupplyQuartermasterForageFactor +
    (stratScore / 100) * config.warSupplyStrategistForageFactor +
    (cgCommandScore / 100) * config.warSupplyCaptainGeneralForageFactor +
    friendlyBonus +
    polityControlBonus +
    cavalryRatio * config.cavalryForageEfficiencyBonus +
    devBonus -
    (prevLocalHostility / 100) * config.warSupplyHostilityForagePenalty -
    crisisPenalty +
    terrainMod

  return clamp(raw, 0.1, 1.5)
}

// Compute supply demand from mobilized regiments. Spec §9.
export function computeSupplyDemand(
  regiments: readonly Regiment[],
  config: SimulationConfig,
): number {
  let total = 0
  for (const r of regiments) {
    if (r.status !== 'active') continue
    const base = r.strength / 100
    if (r.troopKind === 'cavalry') {
      total += base * config.cavalrySupplyDemandMultiplier
    } else {
      total += base
    }
  }
  return total
}

// Compute cavalry ratio (cavalry strength / total strength). Spec §23.
export function computeCavalryRatio(regiments: readonly Regiment[]): number {
  let totalStrength = 0
  let cavalryStrength = 0
  for (const r of regiments) {
    if (r.status !== 'active') continue
    totalStrength += r.strength
    if (r.troopKind === 'cavalry') cavalryStrength += r.strength
  }
  if (totalStrength === 0) return 0
  return cavalryStrength / totalStrength
}

// Compute shortage band from supplyPressure. Spec §11.
export function computeShortageBand(
  supplyPressure: number,
  config: SimulationConfig,
): SupplyShortageBand {
  if (supplyPressure >= config.warSupplyPressureCatastrophicThreshold) return 'catastrophic'
  if (supplyPressure >= config.warSupplyPressureSevereThreshold) return 'severe'
  if (supplyPressure >= config.warSupplyPressureModerateThreshold) return 'moderate'
  if (supplyPressure >= config.warSupplyPressureMildThreshold) return 'mild'
  return 'none'
}

// Get the average POP unrest for a province (used in localHostility calculation). Spec §12.
export function getProvinceAveragePopUnrest(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let totalUnrest = 0
  let count = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      totalUnrest += pop.unrest
      count++
    }
  }
  if (count === 0) return 0
  return totalUnrest / count
}
