import type { PersonId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'

export function movePersonToHouse(
  state: WorldState,
  personId: PersonId,
  newHouseId: HouseId,
): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'movePersonToHouse: person not found: ' + personId,
    })

  const newHouse = state.houses[newHouseId]
  if (!newHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'movePersonToHouse: target house not found: ' + newHouseId,
    })

  const oldHouse = state.houses[person.houseId]
  if (!oldHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'movePersonToHouse: source house not found: ' + person.houseId,
    })

  if (person.houseId === newHouseId) {
    return ok(state)
  }

  const newPersons = { ...state.persons }
  newPersons[personId] = {
    ...person,
    houseId: newHouseId,
    countryId: newHouse.countryId,
  }

  const newHouses = { ...state.houses }
  newHouses[oldHouse.id] = {
    ...oldHouse,
    memberIds: oldHouse.memberIds.filter((id) => id !== personId),
  }
  newHouses[newHouse.id] = {
    ...newHouse,
    memberIds: [...newHouse.memberIds, personId],
  }

  return ok({
    ...state,
    persons: newPersons,
    houses: newHouses,
  })
}
