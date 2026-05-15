import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { RoleType } from '../types/role'
import type { WorldState } from '../types/world'
import { getPersonRole } from './roleSelectors'

function makeFixture({
  roleAssignments = {},
}: {
  roleAssignments?: Partial<Record<RoleType, PersonId>>
} = {}): {
  state: WorldState
  country1Id: CountryId
  country2Id: CountryId
  house1Id: HouseId
  house2Id: HouseId
  person1Id: PersonId
} {
  const country1Id = createCountryId('c', 0)
  const country2Id = createCountryId('c', 1)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const person1Id = createPersonId('pe', 0)

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
        legitimacy: 80,
        adminPower: 10,
        stability: 0,
        roleAssignments,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
      [country2Id]: {
        id: country2Id,
        name: 'Country 2',
        rulerHouseId: house2Id,
        houseIds: [house2Id],
        treasury: 100,
        legitimacy: 80,
        adminPower: 10,
        stability: 0,
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
        memberIds: [],
        headId: person1Id,
        cadetHouseIds: [],
        prestige: 50,
        cohesion: 50,
        loyaltyToCountry: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
      [house2Id]: {
        id: house2Id,
        name: 'House 2',
        active: true,
        countryId: country2Id,
        provinceIds: [],
        memberIds: [],
        headId: createPersonId('pe', 1),
        cadetHouseIds: [],
        prestige: 50,
        cohesion: 50,
        loyaltyToCountry: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [person1Id]: {
        id: person1Id,
        name: 'Test Person',
        sex: 'male',
        age: 30,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        childIds: [],
        birthStatus: 'unknown',
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
        prestige: 50,
      },
    },
    activePlots: {},
    popGroups: {},
  }
  return {
    state,
    country1Id,
    country2Id,
    house1Id,
    house2Id,
    person1Id,
  }
}

describe('getPersonRole', () => {
  it('Returns null when person has no role', () => {
    const { state, person1Id } = makeFixture()
    const result = getPersonRole(state, person1Id)

    expect(result).toBeNull()
  })

  it('Returns correct RoleType when person has a role', () => {
    const { state, person1Id, country1Id } = makeFixture()
    const stateWithRole: WorldState = {
      ...state,
      countries: {
        ...state.countries,
        [country1Id]: {
          ...state.countries[country1Id],
          roleAssignments: { chancellor: person1Id },
          active: true,
          capitalProvinceId: '' as ProvinceId,
        },
      },
    }

    expect(getPersonRole(stateWithRole, person1Id)).toBe('chancellor')
  })

  it('Works when multiple countries exist', () => {
    const country1Id = createCountryId('c', 0)
    const country2Id = createCountryId('c', 1)
    const house1Id = createHouseId('h', 0)
    const house2Id = createHouseId('h', 1)
    const person1Id = createPersonId('pe', 0)
    const person2Id = createPersonId('pe', 1)

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
          legitimacy: 80,
          adminPower: 10,
          stability: 0,
          roleAssignments: { general: person1Id },
          active: true,
          capitalProvinceId: '' as ProvinceId,
        },
        [country2Id]: {
          id: country2Id,
          name: 'Country 2',
          rulerHouseId: house2Id,
          houseIds: [house2Id],
          treasury: 100,
          legitimacy: 80,
          adminPower: 10,
          stability: 0,
          roleAssignments: { treasurer: person2Id },
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
          memberIds: [],
          headId: person1Id,
          cadetHouseIds: [],
          prestige: 50,
          cohesion: 50,
          loyaltyToCountry: 50,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
        [house2Id]: {
          id: house2Id,
          name: 'House 2',
          active: true,
          countryId: country2Id,
          provinceIds: [],
          memberIds: [],
          headId: person2Id,
          cadetHouseIds: [],
          prestige: 50,
          cohesion: 50,
          loyaltyToCountry: 50,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
      },
      persons: {
        [person1Id]: {
          id: person1Id,
          name: 'Person 1',
          sex: 'male',
          age: 30,
          alive: true,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'unknown',
          stats: { admin: 5, martial: 5 },
          traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
          prestige: 50,
        },
        [person2Id]: {
          id: person2Id,
          name: 'Person 2',
          sex: 'male',
          age: 30,
          alive: true,
          houseId: house2Id,
          countryId: country2Id,
          childIds: [],
          birthStatus: 'unknown',
          stats: { admin: 5, martial: 5 },
          traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
          prestige: 50,
        },
      },
      activePlots: {},
      popGroups: {},
    }

    expect(getPersonRole(state, person1Id)).toBe('general')
    expect(getPersonRole(state, person2Id)).toBe('treasurer')
  })
})
