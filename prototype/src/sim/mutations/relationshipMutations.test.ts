import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { setSpouse } from './relationshipMutations'

function makeFixture(): {
  state: WorldState
  person1Id: PersonId
  person2Id: PersonId
  house1Id: HouseId
  country1Id: CountryId
} {
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)
  const house1Id = createHouseId('h', 0)
  const country1Id = createCountryId('c', 0)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [country1Id]: {
        id: country1Id,
        name: 'Country 1',
        houseIds: [house1Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        name: 'House 1',
        active: true,
        countryId: country1Id,
        provinceIds: [],
        memberIds: [person1Id, person2Id],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [person1Id]: {
        id: person1Id,
        name: 'Person 1',
        sex: 'male' as const,
        age: 30,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        childIds: [],
        birthStatus: 'legitimate' as const,
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 10,
        wealth: 0,
        attitudes: {},
      },
      [person2Id]: {
        id: person2Id,
        name: 'Person 2',
        sex: 'female' as const,
        age: 28,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        childIds: [],
        birthStatus: 'legitimate' as const,
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 10,
        wealth: 0,
        attitudes: {},
      },
    },
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  }
  return { state, person1Id, person2Id, house1Id, country1Id }
}

describe('setSpouse', () => {
  it('sets bidirectional spouseId on both persons', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const result = setSpouse(state, person1Id, person2Id)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.persons[person1Id]!.spouseId).toBe(person2Id)
      expect(result.value.persons[person2Id]!.spouseId).toBe(person1Id)
    }
  })

  it('returns err when personA not found', () => {
    const { state, person1Id } = makeFixture()
    const result = setSpouse(state, createPersonId('pe', 99), person1Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })

  it('returns err when personB not found', () => {
    const { state, person1Id } = makeFixture()
    const result = setSpouse(state, person1Id, createPersonId('pe', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })

  it('returns err when personA already has a spouse', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const first = setSpouse(state, person1Id, person2Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const result = setSpouse(first.value, person1Id, person2Id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTEGRITY_VIOLATION')
  })

  it('returns err when personB already has a spouse', () => {
    const { state, person1Id, person2Id, house1Id, country1Id } = makeFixture()
    const first = setSpouse(state, person1Id, person2Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const person3Id = createPersonId('pe', 2)
    const stateWithPerson3: WorldState = {
      ...first.value,
      persons: {
        ...first.value.persons,
        [person3Id]: {
          id: person3Id,
          name: 'Person 3',
          sex: 'male' as const,
          age: 25,
          alive: true,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'unknown' as const,
          stats: { admin: 5, martial: 5 },
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
      },
    }
    const result = setSpouse(stateWithPerson3, person3Id, person2Id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTEGRITY_VIOLATION')
  })
})
