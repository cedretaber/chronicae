import { clamp, clamp100 } from '@sim/utils/math'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { PolityId, HouseId, PersonId, ProvinceId, PopGroupId } from '@sim/types/ids'
import { getProvinceUnrest } from '@sim/selectors/popSelectors'
import {
  getEffectiveOfficeStat,
  getAdministrativeEfficiency,
  getHouseLeader,
} from '@sim/selectors/officeSelectors'
import {
  attitudeValueToScore,
  getAttitudeOrDefault,
  getExplicitAttitude,
} from '@sim/helpers/attitudeHelpers'
import { getPolityHouseIds, getHousePrimaryPolityId } from '../selectors/polityRelations'
import {
  getProvinceTerminalPolityId,
  getProvincePolityControlFromHoldings,
} from '../selectors/landContractSelectors'

// --- Utility ---

// Computes weighted average. Returns fallback if values array is empty or total weight is 0.
export function weightedAverage(
  values: Array<{ value: number; weight: number }>,
  fallback: number,
): number {
  let weightedSum = 0
  let totalWeight = 0
  for (const { value, weight } of values) {
    weightedSum += value * weight
    totalWeight += weight
  }
  if (totalWeight === 0) return fallback
  return weightedSum / totalWeight
}

// --- getPolityLegitimacy (spec §7.2) ---

export function getPolityLegitimacy(state: WorldState, countryId: PolityId): number {
  const country = state.polities[countryId]
  if (!country) return 50

  const countryTarget = { kind: 'polity' as const, id: countryId }

  // Collect alive persons in this polity
  const personScores: number[] = []
  for (const houseId of getPolityHouseIds(state, countryId)) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    for (const memberId of house.memberIds) {
      const person = state.persons[memberId]
      if (!person || !person.alive) continue
      const att = getAttitudeOrDefault(state, person, countryTarget)
      // affection weight 0.35, respect weight 0.65
      const score =
        attitudeValueToScore(att.affection) * 0.35 + attitudeValueToScore(att.respect) * 0.65
      personScores.push(score)
    }
  }
  const personScore =
    personScores.length > 0 ? personScores.reduce((sum, s) => sum + s, 0) / personScores.length : 50

  // Collect PopGroups in polity's provinces (terminal Polity chain ベース)
  const popValues: Array<{ value: number; weight: number }> = []
  for (const provinceId of Object.keys(state.provinces) as ProvinceId[]) {
    const province = state.provinces[provinceId]
    if (!province) continue
    if (getProvinceTerminalPolityId(state, provinceId) !== countryId) continue
    for (const holdingId of province.holdingIds) {
      const holdingPopIds = state.popIndex.byHolding[holdingId]
      if (!holdingPopIds) continue
      for (const popId of holdingPopIds) {
        const pop = state.popGroups[popId]
        if (!pop) continue
        const att = getAttitudeOrDefault(state, pop, countryTarget)
        // affection weight 0.40, respect weight 0.60
        const score =
          attitudeValueToScore(att.affection) * 0.4 + attitudeValueToScore(att.respect) * 0.6
        popValues.push({ value: score, weight: pop.size })
      }
    }
  }
  const popScore = weightedAverage(popValues, 50)

  return clamp(0.35 * personScore + 0.45 * popScore + 0.2 * country.legacyPrestige, 0, 100)
}

// --- getPolityStability (spec §7.3, BFS from capital) ---

export function getPolityStability(
  state: WorldState,
  _config: SimulationConfig,
  countryId: PolityId,
): number {
  const country = state.polities[countryId]
  if (!country) return 50

  const capitalId = country.capitalProvinceId

  // BFS to compute distance from capital for each province in the polity
  const distMap = new Map<ProvinceId, number>()
  const queue: ProvinceId[] = [capitalId]
  distMap.set(capitalId, 0)

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    const dist = distMap.get(current)
    if (dist === undefined) break
    const prov = state.provinces[current]
    if (!prov) continue
    for (const neighborId of prov.neighbors) {
      if (distMap.has(neighborId)) continue
      const neighbor = state.provinces[neighborId]
      if (!neighbor) continue
      if (getProvinceTerminalPolityId(state, neighborId) !== countryId) continue
      distMap.set(neighborId, dist + 1)
      queue.push(neighborId)
    }
  }

  // For provinces not reachable from capital, use distance = 5
  const unreachableDistance = 5

  // Compute weighted average of province stability
  const values: Array<{ value: number; weight: number }> = []
  for (const provinceId of Object.keys(state.provinces) as ProvinceId[]) {
    const province = state.provinces[provinceId]
    if (!province) continue
    if (getProvinceTerminalPolityId(state, provinceId) !== countryId) continue
    const dist = distMap.get(provinceId) ?? unreachableDistance
    const unrest = getProvinceUnrest(state, provinceId)
    // provinceStability = 0.70*(100-unrest) + 0.30*polityControl
    const polityControl = getProvincePolityControlFromHoldings(state, provinceId)
    const provinceStability = clamp100(0.7 * (100 - unrest) + 0.3 * polityControl)
    const weight = 1 / (1 + dist)
    values.push({ value: provinceStability, weight })
  }

  return weightedAverage(values, 50)
}

// --- getHouseCohesion (spec §7.4) ---

export function getHouseCohesion(state: WorldState, houseId: HouseId): number {
  const house = state.houses[houseId]
  if (!house) return 50

  const headId = getHouseLeader(state, houseId)
  if (!headId) return 50

  const headTarget = { kind: 'person' as const, id: headId }
  const scores: number[] = []

  for (const memberId of house.memberIds) {
    if (memberId === headId) continue // exclude head
    const person = state.persons[memberId]
    if (!person || !person.alive) continue
    const att = getAttitudeOrDefault(state, person, headTarget)
    // affection weight 0.45, respect weight 0.55
    const score =
      attitudeValueToScore(att.affection) * 0.45 + attitudeValueToScore(att.respect) * 0.55
    scores.push(score)
  }

  if (scores.length === 0) return 50
  return clamp100(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

// --- getHouseLoyaltyToPolity (spec §7.5) ---

export function getHouseLoyaltyToPolity(state: WorldState, houseId: HouseId): number {
  const house = state.houses[houseId]
  if (!house) return 50

  const primaryPolityId = getHousePrimaryPolityId(state, houseId)
  if (!primaryPolityId) return 50

  const countryTarget = { kind: 'polity' as const, id: primaryPolityId }
  const scores: number[] = []

  for (const memberId of house.memberIds) {
    const person = state.persons[memberId]
    if (!person || !person.alive) continue
    const att = getAttitudeOrDefault(state, person, countryTarget)
    // affection weight 0.55, respect weight 0.45
    const score =
      attitudeValueToScore(att.affection) * 0.55 + attitudeValueToScore(att.respect) * 0.45
    scores.push(score)
  }

  if (scores.length === 0) return 50
  return clamp100(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

// --- getPolityPrestige (spec §7.6) ---
// prestige = 0.70 * legacyPrestige + 0.30 * averageRespectToTargetScore

export function getPolityPrestige(state: WorldState, countryId: PolityId): number {
  const country = state.polities[countryId]
  if (!country) return 0

  const countryTarget = { kind: 'polity' as const, id: countryId }
  const respectScores: number[] = []

  // Collect respect from all Persons in the world
  for (const personId of state.livingPersonIds) {
    const person = state.persons[personId]
    if (!person) continue
    const att = getExplicitAttitude(person.attitudes, countryTarget)
    if (att !== undefined) {
      respectScores.push(attitudeValueToScore(att.respect))
    }
  }
  // Collect respect from all PopGroups in the world
  for (const popId of Object.keys(state.popGroups) as PopGroupId[]) {
    const pop = state.popGroups[popId]
    if (!pop) continue
    const att = getExplicitAttitude(pop.attitudes, countryTarget)
    if (att !== undefined) {
      respectScores.push(attitudeValueToScore(att.respect))
    }
  }

  const averageRespect =
    respectScores.length > 0
      ? respectScores.reduce((sum, s) => sum + s, 0) / respectScores.length
      : country.legacyPrestige // fallback to legacyPrestige

  return clamp100(0.7 * country.legacyPrestige + 0.3 * averageRespect)
}

export function getHousePrestige(state: WorldState, houseId: HouseId): number {
  const house = state.houses[houseId]
  if (!house) return 0

  const houseTarget = { kind: 'house' as const, id: houseId }
  const respectScores: number[] = []

  for (const personId of state.livingPersonIds) {
    const person = state.persons[personId]
    if (!person) continue
    const att = getExplicitAttitude(person.attitudes, houseTarget)
    if (att !== undefined) {
      respectScores.push(attitudeValueToScore(att.respect))
    }
  }
  for (const popId of Object.keys(state.popGroups) as PopGroupId[]) {
    const pop = state.popGroups[popId]
    if (!pop) continue
    const att = getExplicitAttitude(pop.attitudes, houseTarget)
    if (att !== undefined) {
      respectScores.push(attitudeValueToScore(att.respect))
    }
  }

  const averageRespect =
    respectScores.length > 0
      ? respectScores.reduce((sum, s) => sum + s, 0) / respectScores.length
      : house.legacyPrestige

  return clamp100(0.7 * house.legacyPrestige + 0.3 * averageRespect)
}

export function getPersonPrestige(state: WorldState, personId: PersonId): number {
  const person = state.persons[personId]
  if (!person) return 0

  const personTarget = { kind: 'person' as const, id: personId }
  const respectScores: number[] = []

  for (const otherId of state.livingPersonIds) {
    if (otherId === personId) continue
    const other = state.persons[otherId]
    if (!other) continue
    const att = getExplicitAttitude(other.attitudes, personTarget)
    if (att !== undefined) {
      respectScores.push(attitudeValueToScore(att.respect))
    }
  }

  const averageRespect =
    respectScores.length > 0
      ? respectScores.reduce((sum, s) => sum + s, 0) / respectScores.length
      : person.legacyPrestige

  return clamp100(0.7 * person.legacyPrestige + 0.3 * averageRespect)
}

// --- getPolityAdminPower (spec §7.7) ---

export function getPolityAdminPower(
  state: WorldState,
  config: SimulationConfig,
  countryId: PolityId,
): number {
  const country = state.polities[countryId]
  if (!country) return 0

  const countryRef = { kind: 'polity' as const, id: countryId }
  const stability = getPolityStability(state, config, countryId)
  const treasuryScore = clamp(Math.log1p(country.treasury) * 10, 0, 100)
  const efficiency = getAdministrativeEfficiency(state, config, countryId)

  const rulerContrib =
    getEffectiveOfficeStat(state, config, countryRef, 'leader') * config.rulerAdminCapacityFactor
  const adminContrib =
    getEffectiveOfficeStat(state, config, countryRef, 'administrator') *
    config.administratorCapacityFactor
  const treasurerContrib =
    getEffectiveOfficeStat(state, config, countryRef, 'treasurer') * config.treasurerCapacityFactor

  return clamp100(
    (rulerContrib + adminContrib + treasurerContrib) * efficiency * 0.5 +
      stability * 0.2 +
      country.legacyPrestige * 0.15 +
      treasuryScore * 0.15,
  )
}
