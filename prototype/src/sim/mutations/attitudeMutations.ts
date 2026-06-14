import type { PersonId, PolityId, HouseId, PopGroupId, HoldingId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { Attitude } from '../types/attitude'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'
import {
  adjustAttitude,
  setAttitude,
  updateAttitudeIfExists,
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

// v0.17 §11.x: like adjustPersonAttitude, but ONLY updates if the target attitude key
// already exists. If the key is absent, returns state unchanged (does NOT create it).
// Used by FactionPatronageSystem to avoid creating new attitude keys for routine
// donations / stipends (decisions §2.12).
export function adjustPersonAttitudeIfExists(
  state: WorldState,
  personId: PersonId,
  target: AttitudeTarget,
  delta: Partial<Attitude>,
): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'adjustPersonAttitudeIfExists: person not found: ' + personId,
    })

  const key = targetKey(target)
  const newAttitudes = updateAttitudeIfExists(person.attitudes, key, delta)
  if (newAttitudes === person.attitudes) return ok(state) // no change
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

// v0.48: 民衆反乱の負フィードバック配線。holding 内の指定 class POP の領主家 (ownerHouse) への
//   affection を delta だけ動かす (悪政の蓄積を実変数化)。ownerHouse が無い (commonwealth 等)
//   場合や POP が居ない場合は no-op。反乱 tendency の noble disloyalty 項と branch 選択の両方が
//   この値を読むため、delta は控えめに設定する (balance coupling — defaultConfig 参照)。
export function worsenPopAttitudeTowardOwnerHouse(
  state: WorldState,
  holdingId: HoldingId,
  claimantPopClass: PopClass,
  ownerHouseId: HouseId | undefined,
  affectionDelta: number,
): WorldState {
  if (ownerHouseId === undefined) return state
  const popIds = state.popIndex.byHolding[holdingId]
  if (!popIds) return state
  let next = state
  for (const popId of popIds) {
    const p = next.popGroups[popId]
    if (!p || p.class !== claimantPopClass) continue
    const r = adjustPopAttitude(
      next,
      popId,
      { kind: 'house', id: ownerHouseId },
      { affection: affectionDelta },
    )
    if (r.ok) next = r.value
  }
  return next
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

// v0.17 §12/§13: overwrites (sets, not adjusts) a Person's attitude key.
// Used by Faction formation / recruitment which initializes the relationship
// with explicit values (key-creation is intentional).
export function setPersonAttitude(
  state: WorldState,
  personId: PersonId,
  target: AttitudeTarget,
  attitude: { affection: number; respect: number },
): StateResult {
  const person = state.persons[personId]
  if (!person)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: 'setPersonAttitude: person not found: ' + personId,
    })
  const key = targetKey(target)
  const newAttitudes = setAttitude(person.attitudes, key, attitude)
  return ok({
    ...state,
    persons: { ...state.persons, [personId]: { ...person, attitudes: newAttitudes } },
  })
}
