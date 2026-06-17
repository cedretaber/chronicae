import { clamp } from '@sim/utils/math'
import type { WorldState } from '@sim/types/world'
import type { PolityId, HouseId, PersonId } from '@sim/types/ids'
import type { AttitudeKey, AttitudeMap, Attitude } from '@sim/types/attitude'
import type { Person } from '@sim/types/person'
import type { PopGroup } from '@sim/types/popGroup'
import type { AttitudeTarget } from '@sim/mutations/attitudeMutations'

// --- Key builders ---

export function polityAttitudeKey(id: PolityId): AttitudeKey {
  return `polity:${id}`
}

export function houseAttitudeKey(id: HouseId): AttitudeKey {
  return `house:${id}`
}

export function personAttitudeKey(id: PersonId): AttitudeKey {
  return `person:${id}`
}

// --- Value converter ---

// Converts -100..100 to 0..100
export function attitudeValueToScore(v: number): number {
  return clamp((v + 100) / 2, 0, 100)
}

// --- Attitude accessors ---

// Returns the Attitude if it exists, undefined otherwise
export function getExplicitAttitude(
  attitudes: AttitudeMap,
  target: AttitudeTarget,
): Attitude | undefined {
  return attitudes[attitudeTargetToKey(target)]
}

function attitudeTargetToKey(target: AttitudeTarget): AttitudeKey {
  switch (target.kind) {
    case 'person':
      return personAttitudeKey(target.id)
    case 'polity':
      return polityAttitudeKey(target.id)
    case 'house':
      return houseAttitudeKey(target.id)
  }
}

// Returns the Attitude if it exists, or { affection: 0, respect: 0 } as default
// Note: _state parameter is reserved for future use (e.g., looking up heritage modifiers)
export function getAttitudeOrDefault(
  _state: WorldState,
  source: Person | PopGroup,
  target: AttitudeTarget,
): Attitude {
  const key = attitudeTargetToKey(target)
  return source.attitudes[key] ?? { affection: 0, respect: 0 }
}

// --- Attitude mutators (return new AttitudeMap, not mutate in place) ---

// Sets the attitude for the given key, clamping affection/respect to -100..100
export function setAttitude(
  attitudes: AttitudeMap,
  key: AttitudeKey,
  attitude: Attitude,
): AttitudeMap {
  return {
    ...attitudes,
    [key]: {
      affection: clamp(attitude.affection, -100, 100),
      respect: clamp(attitude.respect, -100, 100),
    },
  }
}

// Adjusts the attitude for the given key by delta values, clamping to -100..100
// If the key doesn't exist, starts from { affection: 0, respect: 0 }
export function adjustAttitude(
  attitudes: AttitudeMap,
  key: AttitudeKey,
  delta: Partial<Attitude>,
): AttitudeMap {
  const current = attitudes[key] ?? { affection: 0, respect: 0 }
  return {
    ...attitudes,
    [key]: {
      affection: clamp(current.affection + (delta.affection ?? 0), -100, 100),
      respect: clamp(current.respect + (delta.respect ?? 0), -100, 100),
    },
  }
}

// v0.40 §7.2: current を target へ rate だけ近づける（線形補間）。
//   current が undefined なら default { 0, 0 } から。値は -100..100 に clamp する。
//   LifeStageInfluenceSystem が幼年期/思春期の Attitude 形成に使う。
export function lerpAttitude(
  current: Attitude | undefined,
  target: Attitude,
  rate: number,
): Attitude {
  const cur = current ?? { affection: 0, respect: 0 }
  return {
    affection: clamp(cur.affection + (target.affection - cur.affection) * rate, -100, 100),
    respect: clamp(cur.respect + (target.respect - cur.respect) * rate, -100, 100),
  }
}

// Adjusts person.legacyPrestige by delta, clamping to 0..100
export function adjustPersonLegacyPrestige(
  state: WorldState,
  id: PersonId,
  delta: number,
): WorldState {
  const person = state.persons[id]
  if (!person) return state
  return {
    ...state,
    persons: {
      ...state.persons,
      [id]: {
        ...person,
        legacyPrestige: clamp(person.legacyPrestige + delta, 0, 100),
      },
    },
  }
}

// v0.17 §11.x: like adjustAttitude, but ONLY updates if the key already exists.
// If key is absent, returns the input map unchanged (does NOT create the entry).
// Used by FactionPatronageSystem to avoid creating new attitude keys for routine
// donations / stipends (decisions §2.12).
export function updateAttitudeIfExists(
  attitudes: AttitudeMap,
  key: AttitudeKey,
  delta: Partial<Attitude>,
): AttitudeMap {
  const current = attitudes[key]
  if (!current) return attitudes
  return {
    ...attitudes,
    [key]: {
      affection: clamp(current.affection + (delta.affection ?? 0), -100, 100),
      respect: clamp(current.respect + (delta.respect ?? 0), -100, 100),
    },
  }
}
