import type { PersonId, PolityId, HouseId, PopGroupId } from '../types/ids'
import type { Attitude } from '../types/attitude'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'
import {
  adjustAttitude,
  personAttitudeKey,
  polityAttitudeKey,
  houseAttitudeKey,
} from '../helpers/attitudeHelpers'

export type AttitudeTarget =
  | { kind: 'person'; id: PersonId }
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }

function targetKey(target: AttitudeTarget): string {
  switch (target.kind) {
    case 'person':
      return personAttitudeKey(target.id)
    case 'polity':
      return polityAttitudeKey(target.id)
    case 'house':
      return houseAttitudeKey(target.id)
  }
}

export function adjustPersonAttitude(
  state: WorldState,
  personId: PersonId,
  target: AttitudeTarget,
  delta: Partial<Attitude>,
): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'adjustPersonAttitude: person not found: ' + personId,
    })

  const key = targetKey(target)
  const newAttitudes = adjustAttitude(person.attitudes, key, delta)
  return ok({
    ...state,
    persons: { ...state.persons, [personId]: { ...person, attitudes: newAttitudes } },
  })
}

export function adjustPopAttitude(
  state: WorldState,
  popGroupId: PopGroupId,
  target: AttitudeTarget,
  delta: Partial<Attitude>,
): StateResult {
  const pop = state.popGroups[popGroupId]
  if (!pop) return ok(state)

  const key = targetKey(target)
  const newAttitudes = adjustAttitude(pop.attitudes, key, delta)
  return ok({
    ...state,
    popGroups: { ...state.popGroups, [popGroupId]: { ...pop, attitudes: newAttitudes } },
  })
}

export function adjustHouseMembersAttitude(
  state: WorldState,
  houseId: HouseId,
  target: AttitudeTarget,
  delta: Partial<Attitude>,
): StateResult {
  const house = state.houses[houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'adjustHouseMembersAttitude: house not found: ' + houseId,
    })

  const key = targetKey(target)
  const newPersons = { ...state.persons }
  for (const memberId of house.memberIds) {
    const person = newPersons[memberId]
    if (!person || !person.alive) continue
    newPersons[memberId] = {
      ...person,
      attitudes: adjustAttitude(person.attitudes, key, delta),
    }
  }

  return ok({ ...state, persons: newPersons })
}
