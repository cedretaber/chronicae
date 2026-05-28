import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { PersonId, HouseId } from '../types/ids'
import type { Person } from '../types/person'
import type { WorldState } from '../types/world'
import {
  isHouselessPerson,
  isHouseLandless,
  isLandlessHouseMember,
  getHouselessPersons,
} from './availabilitySelectors'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

function makeFixture(): {
  state: WorldState
  houselessPersonId: PersonId
  landedPersonId: PersonId
  landlessPersonId: PersonId
  house1Id: HouseId
  landlessHouseId: HouseId
} {
  const houselessPersonId = createPersonId('pe', 0)
  const landedPersonId = createPersonId('pe', 1)
  const landlessPersonId = createPersonId('pe', 2)
  const house1Id = createHouseId('h', 1)
  const landlessHouseId = createHouseId('h', 2)
  const polity1Id = createPolityId('c', 1)
  const province1Id = createProvinceId('p', 1)

  let state = makeEmptyV016State()
  state = withHouse(state, house1Id, {
    nameKey: 'Landed House',
    active: true,
    memberIds: [landedPersonId],
    seatProvinceId: province1Id,
  })
  state = withHouse(state, landlessHouseId, {
    nameKey: 'Landless House',
    active: true,
    memberIds: [landlessPersonId],
    seatProvinceId: createProvinceId('p', 2),
  })
  state = withPolity(state, polity1Id, {
    nameKey: 'Landed Polity',
    ownerHouseId: house1Id,
    rank: 2,
    active: true,
    capitalProvinceId: province1Id,
  })
  state = withProvince(state, province1Id, { nameKey: 'Landed Province' })
  state = bindProvinceToHouseViaPolity(state, province1Id, polity1Id, house1Id)
  // Create houseless person by setting houseId to a dummy value, then removing it
  const houselessPersonWithHouse = {
    nameKey: 'Houseless Person',
    houseId: house1Id,
  }
  state = withPerson(state, houselessPersonId, houselessPersonWithHouse)
  // Remove houseId to make person truly houseless
  const houselessPerson = state.persons[houselessPersonId]
  if (houselessPerson) {
    const copy: Record<string, unknown> = { ...houselessPerson }
    delete copy['houseId']
    state = {
      ...state,
      persons: { ...state.persons, [houselessPersonId]: copy as typeof houselessPerson },
    }
  }
  state = withPerson(state, landedPersonId, {
    nameKey: 'Landed Person',
    houseId: house1Id,
  })
  state = withPerson(state, landlessPersonId, {
    nameKey: 'Landless Person',
    houseId: landlessHouseId,
  })
  return {
    state,
    houselessPersonId,
    landedPersonId,
    landlessPersonId,
    house1Id,
    landlessHouseId,
  }
}

describe('isHouselessPerson', () => {
  it('returns true for person without houseId', () => {
    const { state, houselessPersonId } = makeFixture()
    expect(isHouselessPerson(state, houselessPersonId)).toBe(true)
  })

  it('returns false for person in a house', () => {
    const { state, landedPersonId } = makeFixture()
    expect(isHouselessPerson(state, landedPersonId)).toBe(false)
  })

  it('returns false for placeholder person without houseId', () => {
    const { state } = makeFixture()
    const placeholderId = createPersonId('pe', 99)
    const placeholderWithHouse: Partial<Person> & { houseId: HouseId } = {
      nameKey: 'Placeholder',
      kind: 'placeholder',
      houseId: createHouseId('h', 99),
    }
    let updatedState = withPerson(state, placeholderId, placeholderWithHouse)
    // Remove houseId to make it houseless (but still placeholder)
    const p = updatedState.persons[placeholderId]
    if (p) {
      const copy: Record<string, unknown> = { ...p }
      delete copy['houseId']
      updatedState = {
        ...updatedState,
        persons: { ...updatedState.persons, [placeholderId]: copy as typeof p },
      }
    }
    expect(isHouselessPerson(updatedState, placeholderId)).toBe(false)
  })

  it('returns false for missing person', () => {
    const { state } = makeFixture()
    expect(isHouselessPerson(state, createPersonId('pe', 99))).toBe(false)
  })
})

describe('isHouseLandless', () => {
  it('returns false for landed house', () => {
    const { state, house1Id } = makeFixture()
    expect(isHouseLandless(state, house1Id)).toBe(false)
  })

  it('returns false for landless house (no controlled provinces)', () => {
    const { state, landlessHouseId } = makeFixture()
    expect(isHouseLandless(state, landlessHouseId)).toBe(true)
  })

  it('returns false for inactive house', () => {
    const { state } = makeFixture()
    const inactiveHouseId = createHouseId('h', 99)
    const updatedState = withHouse(state, inactiveHouseId, { active: false })
    expect(isHouseLandless(updatedState, inactiveHouseId)).toBe(false)
  })

  it('returns false for missing house', () => {
    const { state } = makeFixture()
    expect(isHouseLandless(state, createHouseId('h', 99))).toBe(false)
  })
})

describe('isLandlessHouseMember', () => {
  it('returns true for member of landless house', () => {
    const { state, landlessPersonId } = makeFixture()
    expect(isLandlessHouseMember(state, landlessPersonId)).toBe(true)
  })

  it('returns false for member of landed house', () => {
    const { state, landedPersonId } = makeFixture()
    expect(isLandlessHouseMember(state, landedPersonId)).toBe(false)
  })

  it('returns false for houseless person', () => {
    const { state, houselessPersonId } = makeFixture()
    expect(isLandlessHouseMember(state, houselessPersonId)).toBe(false)
  })

  it('returns false for missing person', () => {
    const { state } = makeFixture()
    expect(isLandlessHouseMember(state, createPersonId('pe', 99))).toBe(false)
  })
})

describe('getHouselessPersons', () => {
  it('returns persons without houseId (non-placeholder)', () => {
    const { state, houselessPersonId } = makeFixture()
    const result = getHouselessPersons(state)
    expect(result).toContain(houselessPersonId)
  })

  it('excludes placeholder persons without houseId', () => {
    const { state } = makeFixture()
    const placeholderId = createPersonId('pe', 99)
    const placeholderWithHouse: Partial<Person> & { houseId: HouseId } = {
      nameKey: 'Placeholder',
      kind: 'placeholder',
      houseId: createHouseId('h', 99),
    }
    let updatedState = withPerson(state, placeholderId, placeholderWithHouse)
    // Remove houseId to make it houseless (but still placeholder)
    const p = updatedState.persons[placeholderId]
    if (p) {
      const copy: Record<string, unknown> = { ...p }
      delete copy['houseId']
      updatedState = {
        ...updatedState,
        persons: { ...updatedState.persons, [placeholderId]: copy as typeof p },
      }
    }
    const result = getHouselessPersons(updatedState)
    expect(result).not.toContain(placeholderId)
  })

  it('returns empty if no houseless persons exist', () => {
    const state: WorldState = {
      ...makeEmptyV016State(),
      persons: {},
    }
    const result = getHouselessPersons(state)
    expect(result).toEqual([])
  })
})
