import type { WorldState } from '@sim/types/world'
import type { PersonId, HouseId } from '@sim/types/ids'
import {
  getHouseControlledProvinceIds,
  getHouseOwnedPolityIds,
} from '@sim/selectors/landContractSelectors'
import { getHouseAggregateInfluenceInPolity } from '@sim/selectors/influenceSelectors'
import type { SimulationConfig } from '@sim/config/defaultConfig'

export function isHouselessPerson(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  return person.houseId === undefined && person.kind !== 'placeholder'
}

export function getHouselessPersons(state: WorldState): PersonId[] {
  const result: PersonId[] = []
  for (const personId of state.livingPersonIds) {
    const person = state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (person.houseId !== undefined) continue
    result.push(person.id)
  }
  return result
}

export function isHouseLandless(state: WorldState, houseId: HouseId): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  return getHouseControlledProvinceIds(state, houseId).length === 0
}

export function isLandlessHouseMember(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (!person.houseId) return false
  return isHouseLandless(state, person.houseId)
}

export function isRulingHouse(state: WorldState, houseId: HouseId): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  const polityIds = getHouseOwnedPolityIds(state, houseId)
  for (const pid of polityIds) {
    const polity = state.polities[pid]
    if (polity && polity.active) return true
  }
  return false
}

// v0.42 §19.2: share% → influence%。config 名も influentialHousePolityInfluenceThreshold に改名。
export function isInfluentialHouseInAnyPolity(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  const threshold = config.influentialHousePolityInfluenceThreshold * 100
  for (const polity of Object.values(state.polities)) {
    if (!polity || !polity.active) continue
    if (polity.ownerHouseId === houseId) continue
    const influencePercent = getHouseAggregateInfluenceInPolity(
      state,
      config,
      houseId,
      polity.id,
    ).percent
    if (influencePercent >= threshold) return true
  }
  return false
}

export function isInfluentialHouse(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): boolean {
  if (isRulingHouse(state, houseId)) return true
  if (isInfluentialHouseInAnyPolity(state, config, houseId)) return true
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  if (house.wealth >= config.influentialHouseWealthThreshold) return true
  if (house.legacyPrestige >= config.influentialHouseLegacyPrestigeThreshold) return true
  return false
}
