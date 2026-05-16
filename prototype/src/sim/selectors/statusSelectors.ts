import { clamp, clamp100 } from '@sim/utils/math'
import type { WorldState } from '@sim/types/world'
import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { CountryId, HouseId, PersonId, ProvinceId, PopGroupId } from '@sim/types/ids'
import { getProvinceUnrest } from '@sim/selectors/popSelectors'
import { getAssignedLivingPerson } from '@sim/selectors/personAbilityEffects'
import {
  countryAttitudeKey,
  houseAttitudeKey,
  personAttitudeKey,
  attitudeValueToScore,
  getAttitudeOrDefault,
} from '@sim/helpers/attitudeHelpers'

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

// --- getCountryLegitimacy (spec §7.2) ---

export function getCountryLegitimacy(state: WorldState, countryId: CountryId): number {
  const country = state.countries[countryId]
  if (!country) return 50

  const countryKey = countryAttitudeKey(countryId)

  // Collect alive persons in this country
  const personScores: number[] = []
  for (const houseId of country.houseIds) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue
    for (const memberId of house.memberIds) {
      const person = state.persons[memberId]
      if (!person || !person.alive) continue
      const att = getAttitudeOrDefault(state, person, countryKey)
      // affection weight 0.35, respect weight 0.65
      const score =
        attitudeValueToScore(att.affection) * 0.35 + attitudeValueToScore(att.respect) * 0.65
      personScores.push(score)
    }
  }
  const personScore =
    personScores.length > 0 ? personScores.reduce((sum, s) => sum + s, 0) / personScores.length : 50

  // Collect PopGroups in country's provinces
  const popValues: Array<{ value: number; weight: number }> = []
  for (const provinceId of Object.keys(state.provinces) as ProvinceId[]) {
    const province = state.provinces[provinceId]
    if (!province || province.countryId !== countryId) continue
    for (const popId of province.popGroupIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      const att = getAttitudeOrDefault(state, pop, countryKey)
      // affection weight 0.40, respect weight 0.60
      const score =
        attitudeValueToScore(att.affection) * 0.4 + attitudeValueToScore(att.respect) * 0.6
      popValues.push({ value: score, weight: pop.size })
    }
  }
  const popScore = weightedAverage(popValues, 50)

  return clamp(0.35 * personScore + 0.45 * popScore + 0.2 * country.legacyPrestige, 0, 100)
}

// --- getCountryStability (spec §7.3, BFS from capital) ---

export function getCountryStability(
  state: WorldState,
  _config: SimulationConfig,
  countryId: CountryId,
): number {
  const country = state.countries[countryId]
  if (!country) return 50

  const capitalId = country.capitalProvinceId

  // BFS to compute distance from capital for each province in the country
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
      if (!neighbor || neighbor.countryId !== countryId) continue
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
    if (!province || province.countryId !== countryId) continue
    const dist = distMap.get(provinceId) ?? unreachableDistance
    const unrest = getProvinceUnrest(state, provinceId)
    // provinceStability = 0.70*(100-unrest) + 0.30*countryControl
    const provinceStability = clamp100(0.7 * (100 - unrest) + 0.3 * province.countryControl)
    const weight = 1 / (1 + dist)
    values.push({ value: provinceStability, weight })
  }

  return weightedAverage(values, 50)
}

// --- getHouseCohesion (spec §7.4) ---

export function getHouseCohesion(state: WorldState, houseId: HouseId): number {
  const house = state.houses[houseId]
  if (!house) return 50

  const headKey = personAttitudeKey(house.headId)
  const scores: number[] = []

  for (const memberId of house.memberIds) {
    if (memberId === house.headId) continue // exclude head
    const person = state.persons[memberId]
    if (!person || !person.alive) continue
    const att = getAttitudeOrDefault(state, person, headKey)
    // affection weight 0.45, respect weight 0.55
    const score =
      attitudeValueToScore(att.affection) * 0.45 + attitudeValueToScore(att.respect) * 0.55
    scores.push(score)
  }

  if (scores.length === 0) return 50
  return clamp100(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

// --- getHouseLoyaltyToCountry (spec §7.5) ---

export function getHouseLoyaltyToCountry(state: WorldState, houseId: HouseId): number {
  const house = state.houses[houseId]
  if (!house) return 50

  const countryKey = countryAttitudeKey(house.countryId)
  const scores: number[] = []

  for (const memberId of house.memberIds) {
    const person = state.persons[memberId]
    if (!person || !person.alive) continue
    const att = getAttitudeOrDefault(state, person, countryKey)
    // affection weight 0.55, respect weight 0.45
    const score =
      attitudeValueToScore(att.affection) * 0.55 + attitudeValueToScore(att.respect) * 0.45
    scores.push(score)
  }

  if (scores.length === 0) return 50
  return clamp100(scores.reduce((sum, s) => sum + s, 0) / scores.length)
}

// --- getXPrestige (spec §7.6) ---
// prestige = 0.70 * legacyPrestige + 0.30 * averageRespectToTargetScore

export function getCountryPrestige(state: WorldState, countryId: CountryId): number {
  const country = state.countries[countryId]
  if (!country) return 0

  const key = countryAttitudeKey(countryId)
  const respectScores: number[] = []

  // Collect respect from all Persons in the world
  for (const personId of Object.keys(state.persons) as PersonId[]) {
    const person = state.persons[personId]
    if (!person || !person.alive) continue
    const att = person.attitudes[key]
    if (att !== undefined) {
      respectScores.push(attitudeValueToScore(att.respect))
    }
  }
  // Collect respect from all PopGroups in the world
  for (const popId of Object.keys(state.popGroups) as PopGroupId[]) {
    const pop = state.popGroups[popId]
    if (!pop) continue
    const att = pop.attitudes[key]
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

  const key = houseAttitudeKey(houseId)
  const respectScores: number[] = []

  for (const personId of Object.keys(state.persons) as PersonId[]) {
    const person = state.persons[personId]
    if (!person || !person.alive) continue
    const att = person.attitudes[key]
    if (att !== undefined) {
      respectScores.push(attitudeValueToScore(att.respect))
    }
  }
  for (const popId of Object.keys(state.popGroups) as PopGroupId[]) {
    const pop = state.popGroups[popId]
    if (!pop) continue
    const att = pop.attitudes[key]
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

  const key = personAttitudeKey(personId)
  const respectScores: number[] = []

  for (const otherId of Object.keys(state.persons) as PersonId[]) {
    if (otherId === personId) continue
    const other = state.persons[otherId]
    if (!other || !other.alive) continue
    const att = other.attitudes[key]
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

// --- getCountryAdminPower (spec §7.7) ---

export function getCountryAdminPower(
  state: WorldState,
  config: SimulationConfig,
  countryId: CountryId,
): number {
  const country = state.countries[countryId]
  if (!country) return 0

  // Look up role holders using getAssignedLivingPerson
  const chancellor = getAssignedLivingPerson(state, country, 'chancellor')
  const treasurer = getAssignedLivingPerson(state, country, 'treasurer')

  const chancellorScore = chancellor ? chancellor.stats.admin * 10 : 50
  const treasurerScore = treasurer ? treasurer.stats.admin * 10 : 50
  const stability = getCountryStability(state, config, countryId)
  const rulerPrestige = getHousePrestige(state, country.rulerHouseId)
  const treasuryScore = clamp(Math.log1p(country.treasury) * 10, 0, 100)

  return clamp100(
    0.3 * chancellorScore +
      0.2 * treasurerScore +
      0.2 * stability +
      0.15 * rulerPrestige +
      0.15 * treasuryScore,
  )
}
