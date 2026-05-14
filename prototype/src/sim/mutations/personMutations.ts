import type { PersonId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'

export function movePersonToHouse(
  state: WorldState,
  personId: PersonId,
  newHouseId: HouseId,
): WorldState {
  const person = state.persons[personId]
  if (!person) throw new Error('movePersonToHouse: person not found: ' + personId)

  const newHouse = state.houses[newHouseId]
  if (!newHouse) throw new Error('movePersonToHouse: target house not found: ' + newHouseId)

  const oldHouse = state.houses[person.houseId]
  if (!oldHouse) throw new Error('movePersonToHouse: source house not found: ' + person.houseId)

  if (person.houseId === newHouseId) {
    return state
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

  return {
    ...state,
    persons: newPersons,
    houses: newHouses,
  }
}

export function setSpouse(state: WorldState, personAId: PersonId, personBId: PersonId): WorldState {
  const personA = state.persons[personAId]
  if (!personA) throw new Error('setSpouse: personA not found: ' + personAId)

  const personB = state.persons[personBId]
  if (!personB) throw new Error('setSpouse: personB not found: ' + personBId)

  if (personA.spouseId) throw new Error('setSpouse: personA already has a spouse')
  if (personB.spouseId) throw new Error('setSpouse: personB already has a spouse')

  const newPersons = { ...state.persons }
  newPersons[personAId] = { ...personA, spouseId: personBId }
  newPersons[personBId] = { ...personB, spouseId: personAId }

  return {
    ...state,
    persons: newPersons,
  }
}
