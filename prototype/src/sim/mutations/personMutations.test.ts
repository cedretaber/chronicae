import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { movePersonToHouse, setSpouse } from './personMutations'

function makeFixture(): {
  state: WorldState
  person1Id: PersonId
  person2Id: PersonId
  house1Id: HouseId
  house2Id: HouseId
  country1Id: CountryId
  country2Id: CountryId
} {
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const country1Id = createCountryId('c', 0)
  const country2Id = createCountryId('c', 1)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [country1Id]: {
        id: country1Id,
        name: 'Country 1',
        rulerHouseId: house1Id,
        houseIds: [house1Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        roleAssignments: {},
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
      [country2Id]: {
        id: country2Id,
        name: 'Country 2',
        rulerHouseId: house2Id,
        houseIds: [house2Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        roleAssignments: {},
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
        memberIds: [person1Id],
        headId: person1Id,
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
      [house2Id]: {
        id: house2Id,
        name: 'House 2',
        active: true,
        countryId: country2Id,
        provinceIds: [],
        memberIds: [person2Id],
        headId: person2Id,
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
        attitudes: {},
      },
      [person2Id]: {
        id: person2Id,
        name: 'Person 2',
        sex: 'female' as const,
        age: 28,
        alive: true,
        houseId: house2Id,
        countryId: country2Id,
        childIds: [],
        birthStatus: 'legitimate' as const,
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 10,
        attitudes: {},
      },
    },
    activePlots: {},
    popGroups: {},
  }
  return {
    state,
    person1Id,
    person2Id,
    house1Id,
    house2Id,
    country1Id,
    country2Id,
  }
}

describe('movePersonToHouse', () => {
  it('updates person.houseId to newHouseId', () => {
    const { state, person1Id, house2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.persons[person1Id]!.houseId).toBe(house2Id)
  })

  it('updates person.countryId to newHouse.countryId', () => {
    const { state, person1Id, house2Id, country2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.persons[person1Id]!.countryId).toBe(country2Id)
  })

  it('removes personId from old house memberIds', () => {
    const { state, person1Id, house1Id, house2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.houses[house1Id]!.memberIds).not.toContain(person1Id)
  })

  it('adds personId to new house memberIds', () => {
    const { state, person1Id, house2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.houses[house2Id]!.memberIds).toContain(person1Id)
  })

  it('returns same state when source and target house are the same (no-op)', () => {
    const { state, person1Id, house1Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house1Id)

    expect(result).toBe(state)
  })

  it('throws when person not found', () => {
    const { state } = makeFixture()

    expect(() => movePersonToHouse(state, createPersonId('pe', 99), createHouseId('h', 0))).toThrow(
      'movePersonToHouse: person not found: pe-99',
    )
  })

  it('throws when target house not found', () => {
    const { state, person1Id } = makeFixture()

    expect(() => movePersonToHouse(state, person1Id, createHouseId('h', 99))).toThrow(
      'movePersonToHouse: target house not found: h-99',
    )
  })
})

describe('setSpouse', () => {
  it('sets bidirectional spouseId on both persons', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const result = setSpouse(state, person1Id, person2Id)

    expect(result.persons[person1Id]!.spouseId).toBe(person2Id)
    expect(result.persons[person2Id]!.spouseId).toBe(person1Id)
  })

  it('throws when personA not found', () => {
    const { state, person1Id } = makeFixture()

    expect(() => setSpouse(state, createPersonId('pe', 99), person1Id)).toThrow(
      'setSpouse: personA not found: pe-99',
    )
  })

  it('throws when personB not found', () => {
    const { state, person1Id } = makeFixture()

    expect(() => setSpouse(state, person1Id, createPersonId('pe', 99))).toThrow(
      'setSpouse: personB not found: pe-99',
    )
  })

  it('throws when personA already has a spouse', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const updatedState = setSpouse(state, person1Id, person2Id)
    expect(() => setSpouse(updatedState, person1Id, person2Id)).toThrow(
      'setSpouse: personA already has a spouse',
    )
  })

  it('throws when personB already has a spouse', () => {
    const { state, person1Id, person2Id, house1Id, country1Id } = makeFixture()
    // person2Id gets a spouse
    const updatedState = setSpouse(state, person1Id, person2Id)
    // Add a new person3 without a spouse, then try to marry them to person2Id (who already has one)
    const person3Id = createPersonId('pe', 2)
    const stateWithPerson3: WorldState = {
      ...updatedState,
      persons: {
        ...updatedState.persons,
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
          attitudes: {},
        },
      },
    }
    expect(() => setSpouse(stateWithPerson3, person3Id, person2Id)).toThrow(
      'setSpouse: personB already has a spouse',
    )
  })
})
