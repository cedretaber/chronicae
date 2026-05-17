import { clamp } from '@sim/utils/math'
import type { WorldState } from '@sim/types/world'
import type { CountryId, HouseId, PersonId } from '@sim/types/ids'
import type { AttitudeKey, AttitudeMap, Attitude } from '@sim/types/attitude'
import type { Person } from '@sim/types/person'
import type { PopGroup } from '@sim/types/popGroup'
import type { AttitudeTarget } from '@sim/mutations/attitudeMutations'

// --- Key builders ---

export function countryAttitudeKey(id: CountryId): AttitudeKey {
  return `country:${id}`
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
    case 'country':
      return countryAttitudeKey(target.id)
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

// --- legacyPrestige adjusters (return new WorldState, immutable) ---

// Adjusts country.legacyPrestige by delta, clamping to 0..100
export function adjustCountryLegacyPrestige(
  state: WorldState,
  id: CountryId,
  delta: number,
): WorldState {
  const country = state.countries[id]
  if (!country) return state
  return {
    ...state,
    countries: {
      ...state.countries,
      [id]: {
        ...country,
        legacyPrestige: clamp(country.legacyPrestige + delta, 0, 100),
      },
    },
  }
}

// Adjusts house.legacyPrestige by delta, clamping to 0..100
export function adjustHouseLegacyPrestige(
  state: WorldState,
  id: HouseId,
  delta: number,
): WorldState {
  const house = state.houses[id]
  if (!house) return state
  return {
    ...state,
    houses: {
      ...state.houses,
      [id]: {
        ...house,
        legacyPrestige: clamp(house.legacyPrestige + delta, 0, 100),
      },
    },
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

// --- Init helpers (minimal implementation — worldgen will populate attitudes directly) ---

// Returns empty AttitudeMap for a new Person
// Worldgen will populate the actual attitudes directly
export function initPersonAttitudes(): AttitudeMap {
  return {}
}

// Returns empty AttitudeMap for a new PopGroup
export function initPopGroupAttitudes(): AttitudeMap {
  return {}
}

// Returns empty AttitudeMap for a new House
export function initNewHouseAttitudes(): AttitudeMap {
  return {}
}

// No-op — worldgen will populate Country-related attitudes directly
export function initNewCountryAttitudes(): void {
  // Attitudes for new countries are initialized by revolt system directly
}
