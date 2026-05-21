import type { WorldState } from '@sim/types/world'
import type { PersonId, HouseId } from '@sim/types/ids'
import { ANONYMOUS_HOUSE_ID } from '@sim/types/house'
import { getHouseControlledProvinceIds } from '@sim/selectors/landContractSelectors'

export function isPersonInAnonymousHouse(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  return person.houseId === ANONYMOUS_HOUSE_ID
}

export function isUnaffiliatedPerson(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (person.houseId !== ANONYMOUS_HOUSE_ID) return false
  return person.kind !== 'placeholder'
}

export function isHouseLandless(state: WorldState, houseId: HouseId): boolean {
  const house = state.houses[houseId]
  if (!house || !house.active) return false
  return getHouseControlledProvinceIds(state, houseId).length === 0
}

export function isLandlessHouseMember(state: WorldState, personId: PersonId): boolean {
  const person = state.persons[personId]
  if (!person) return false
  if (person.houseId === ANONYMOUS_HOUSE_ID) return false
  return isHouseLandless(state, person.houseId)
}

export function getUnaffiliatedPersons(state: WorldState): PersonId[] {
  const anon = state.houses[ANONYMOUS_HOUSE_ID]
  if (!anon) return []
  const result: PersonId[] = []
  for (const memberId of anon.memberIds) {
    const person = state.persons[memberId]
    if (!person) continue
    if (!person.alive) continue
    if (person.kind === 'placeholder') continue
    result.push(memberId)
  }
  return result
}
