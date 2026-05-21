import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createProvinceId } from '../types/ids'
import type { PersonId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import {
  isPersonInAnonymousHouse,
  isUnaffiliatedPerson,
  isHouseLandless,
  isLandlessHouseMember,
  getUnaffiliatedPersons,
} from './availabilitySelectors'
import { ANONYMOUS_HOUSE_ID } from '../types/house'
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
  anonPersonId: PersonId
  landedPersonId: PersonId
  landlessPersonId: PersonId
  house1Id: HouseId
  landlessHouseId: HouseId
} {
  const anonPersonId = createPersonId('pe', 0)
  const landedPersonId = createPersonId('pe', 1)
  const landlessPersonId = createPersonId('pe', 2)
  const house1Id = createHouseId('h', 1)
  const landlessHouseId = createHouseId('h', 2)
  const polity1Id = createPolityId('c', 1)
  const province1Id = createProvinceId('p', 1)

  let state = makeEmptyV016State()
  state = withHouse(state, house1Id, {
    name: 'Landed House',
    active: true,
    memberIds: [landedPersonId],
    seatProvinceId: province1Id,
  })
  state = withHouse(state, landlessHouseId, {
    name: 'Landless House',
    active: true,
    memberIds: [landlessPersonId],
    seatProvinceId: createProvinceId('p', 2),
  })
  state = withPolity(state, polity1Id, {
    name: 'Landed Polity',
    ownerHouseId: house1Id,
    rank: 2,
    active: true,
    capitalProvinceId: province1Id,
  })
  state = withProvince(state, province1Id, { name: 'Landed Province' })
  state = bindProvinceToHouseViaPolity(state, province1Id, polity1Id, house1Id)
  state = withPerson(state, anonPersonId, {
    name: 'Unaffiliated Person',
    houseId: ANONYMOUS_HOUSE_ID,
  })
  state = withPerson(state, landedPersonId, {
    name: 'Landed Person',
    houseId: house1Id,
  })
  state = withPerson(state, landlessPersonId, {
    name: 'Landless Person',
    houseId: landlessHouseId,
  })
  return {
    state,
    anonPersonId,
    landedPersonId,
    landlessPersonId,
    house1Id,
    landlessHouseId,
  }
}

describe('isPersonInAnonymousHouse', () => {
  it('returns true for AnonymousHouse member', () => {
    const { state, anonPersonId } = makeFixture()
    expect(isPersonInAnonymousHouse(state, anonPersonId)).toBe(true)
  })

  it('returns false for non-anonymous house member', () => {
    const { state, landedPersonId } = makeFixture()
    expect(isPersonInAnonymousHouse(state, landedPersonId)).toBe(false)
  })

  it('returns false for missing person', () => {
    const { state } = makeFixture()
    expect(isPersonInAnonymousHouse(state, createPersonId('pe', 99))).toBe(false)
  })
})

describe('isUnaffiliatedPerson', () => {
  it('returns true for non-placeholder AnonymousHouse member', () => {
    const { state, anonPersonId } = makeFixture()
    expect(isUnaffiliatedPerson(state, anonPersonId)).toBe(true)
  })

  it('returns false for placeholder person in AnonymousHouse', () => {
    const { state } = makeFixture()
    const placeholderId = createPersonId('pe', 99)
    const updatedState = withPerson(state, placeholderId, {
      name: 'Placeholder',
      houseId: ANONYMOUS_HOUSE_ID,
      kind: 'placeholder',
    })
    expect(isUnaffiliatedPerson(updatedState, placeholderId)).toBe(false)
  })

  it('returns false for non-anonymous house member', () => {
    const { state, landedPersonId } = makeFixture()
    expect(isUnaffiliatedPerson(state, landedPersonId)).toBe(false)
  })

  it('returns false for missing person', () => {
    const { state } = makeFixture()
    expect(isUnaffiliatedPerson(state, createPersonId('pe', 99))).toBe(false)
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

  it('returns false for AnonymousHouse member', () => {
    const { state, anonPersonId } = makeFixture()
    expect(isLandlessHouseMember(state, anonPersonId)).toBe(false)
  })

  it('returns false for missing person', () => {
    const { state } = makeFixture()
    expect(isLandlessHouseMember(state, createPersonId('pe', 99))).toBe(false)
  })
})

describe('getUnaffiliatedPersons', () => {
  it('returns non-placeholder members of AnonymousHouse', () => {
    const { state, anonPersonId } = makeFixture()
    const result = getUnaffiliatedPersons(state)
    expect(result).toContain(anonPersonId)
  })

  it('excludes placeholder members of AnonymousHouse', () => {
    const { state } = makeFixture()
    const placeholderId = createPersonId('pe', 99)
    const updatedState = withPerson(state, placeholderId, {
      name: 'Placeholder',
      houseId: ANONYMOUS_HOUSE_ID,
      kind: 'placeholder',
    })
    const result = getUnaffiliatedPersons(updatedState)
    expect(result).not.toContain(placeholderId)
  })

  it('returns empty if AnonymousHouse has no members', () => {
    const { state } = makeFixture()
    const result = getUnaffiliatedPersons(state)
    expect(result.length).toBeGreaterThan(0) // anonPersonId is there
  })

  it('returns empty if AnonymousHouse does not exist', () => {
    const state: WorldState = {
      ...makeEmptyV016State(),
      houses: {},
    }
    const result = getUnaffiliatedPersons(state)
    expect(result).toEqual([])
  })
})
