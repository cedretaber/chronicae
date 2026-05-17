import type { TickContext } from '../tick/context'
import { makePersonId } from '../tick/context'
import type { PersonId, HouseId } from '../types/ids'
import type { Person, Sex, BirthStatus } from '../types/person'
import type { WorldState } from '../types/world'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'
import { clearSpouse } from './relationshipMutations'
import { revokeOfficesByHolder } from './officeMutations'

export type BirthChildInput = {
  fatherId: PersonId
  motherId?: PersonId
  birthStatus: BirthStatus
  name: string
  sex: Sex
  stats: { admin: number; martial: number }
  traits: { ambition: number; caution: number }
}

export function markPersonDead(state: WorldState, personId: PersonId): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'markPersonDead: person not found: ' + personId,
    })
  if (!person.alive) return ok(state)

  let newState: WorldState = {
    ...state,
    persons: { ...state.persons, [personId]: { ...person, alive: false } },
  }
  const spouseResult = clearSpouse(newState, personId)
  if (spouseResult.ok) newState = spouseResult.value
  newState = revokeOfficesByHolder(newState, personId)
  return ok(newState)
}

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

export function birthChild(
  ctx: TickContext,
  input: BirthChildInput,
): CtxResult<{ childId: PersonId }> {
  const father = ctx.state.persons[input.fatherId]
  if (!father)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'birthChild: father not found: ' + input.fatherId,
    })

  const house = ctx.state.houses[father.houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'birthChild: house not found: ' + father.houseId,
    })

  const { id: childId, ctx: ctxWithId } = makePersonId(ctx)

  const childBase: Person = {
    id: childId,
    name: input.name,
    sex: input.sex,
    age: 0,
    alive: true,
    houseId: father.houseId,
    countryId: father.countryId,
    fatherId: input.fatherId,
    birthStatus: input.birthStatus,
    childIds: [],
    stats: input.stats,
    traits: input.traits,
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
  }
  const childPerson: Person = input.motherId
    ? { ...childBase, motherId: input.motherId }
    : childBase

  let newPersons: Record<PersonId, Person> = { ...ctxWithId.state.persons, [childId]: childPerson }

  const updatedFather = newPersons[input.fatherId]
  if (updatedFather) {
    newPersons = {
      ...newPersons,
      [input.fatherId]: { ...updatedFather, childIds: [...updatedFather.childIds, childId] },
    }
  }

  if (input.motherId) {
    const updatedMother = newPersons[input.motherId]
    if (updatedMother) {
      newPersons = {
        ...newPersons,
        [input.motherId]: { ...updatedMother, childIds: [...updatedMother.childIds, childId] },
      }
    }
  }

  const newHouses = { ...ctxWithId.state.houses }
  const updatedHouse = newHouses[father.houseId]
  if (updatedHouse) {
    newHouses[father.houseId] = {
      ...updatedHouse,
      memberIds: [...updatedHouse.memberIds, childId],
    }
  }

  const newState = { ...ctxWithId.state, persons: newPersons, houses: newHouses }
  return ok({ ctx: { ...ctxWithId, state: newState }, value: { childId } })
}
