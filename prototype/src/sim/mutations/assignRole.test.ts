import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { RoleType } from '../types/role'
import type { WorldState } from '../types/world'
import { assignRole, revokeRole } from './assignRole'

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
        memberIds: [person1Id],
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

describe('assignRole', () => {
  it('assignRole correctly sets roleAssignments', () => {
    const { state, country1Id, person1Id } = makeFixture()
    const result = assignRole(state, country1Id, 'chancellor', person1Id)

    expect(result.countries[country1Id]!.roleAssignments['chancellor']).toBe(person1Id)
  })

  it('assignRole throws if person does not exist', () => {
    const { state, country1Id } = makeFixture()

    expect(() => assignRole(state, country1Id, 'chancellor', createPersonId('pe', 99))).toThrow(
      'Person not found',
    )
  })

  it('assignRole throws if person is not alive', () => {
    const { state, country1Id, house1Id } = makeFixture()
    const deadPersonId = createPersonId('pe', 99)
    const deadState: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [deadPersonId]: {
          id: deadPersonId,
          name: 'Dead Person',
          sex: 'male',
          age: 80,
          alive: false,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'unknown',
          stats: { admin: 5, martial: 5 },
          traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
          prestige: 50,
        },
      },
    }

    expect(() => assignRole(deadState, country1Id, 'chancellor', deadPersonId)).toThrow(
      'Person is not alive',
    )
  })

  it('assignRole throws if person is in a different country', () => {
    const { state, country1Id, country2Id } = makeFixture()
    const personInOtherCountry = createPersonId('pe', 99)
    const houseInOtherCountry = createHouseId('h', 99)
    const stateWithOtherPerson: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personInOtherCountry]: {
          id: personInOtherCountry,
          name: 'Other Person',
          age: 30,
          alive: true,
          houseId: houseInOtherCountry,
          countryId: country2Id,
          stats: { admin: 5, martial: 5 },
          traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
          prestige: 50,
        },
      },
      houses: {
        ...state.houses,
        [houseInOtherCountry]: {
          id: houseInOtherCountry,
          name: 'Other House',
          active: true,
          countryId: country2Id,
          provinceIds: [],
          memberIds: [personInOtherCountry],
          headId: personInOtherCountry,
          cadetHouseIds: [],
          prestige: 50,
          cohesion: 50,
          loyaltyToCountry: 50,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
      },
    }

    expect(() =>
      assignRole(stateWithOtherPerson, country1Id, 'chancellor', personInOtherCountry),
    ).toThrow('Person is not in the specified country')
  })

  it('assignRole throws if persons house is not active', () => {
    const { state, country1Id, house1Id, person1Id } = makeFixture()
    const inactiveState: WorldState = {
      ...state,
      houses: {
        ...state.houses,
        [house1Id]: {
          ...state.houses[house1Id],
          active: false,
        },
      },
    }

    expect(() => assignRole(inactiveState, country1Id, 'chancellor', person1Id)).toThrow(
      'House is not active',
    )
  })

  it('assignRole throws if person already has a role in the same country', () => {
    const { state, country1Id, person1Id } = makeFixture()
    const stateWithRole: WorldState = {
      ...state,
      countries: {
        ...state.countries,
        [country1Id]: {
          ...state.countries[country1Id],
          roleAssignments: { chancellor: person1Id },
        },
      },
    }

    expect(() => assignRole(stateWithRole, country1Id, 'general', person1Id)).toThrow(
      'Person already has a role in a country',
    )
  })
})

describe('revokeRole', () => {
  it('revokeRole removes the role from roleAssignments', () => {
    const { state, country1Id, person1Id } = makeFixture()
    const stateWithRole: WorldState = {
      ...state,
      countries: {
        ...state.countries,
        [country1Id]: {
          ...state.countries[country1Id],
          roleAssignments: { chancellor: person1Id },
        },
      },
    }
    const result = revokeRole(stateWithRole, country1Id, 'chancellor')

    expect(result.countries[country1Id]!.roleAssignments).not.toHaveProperty('chancellor')
  })

  it('Original state is not mutated after assignRole and revokeRole', () => {
    const { state, country1Id, person1Id } = makeFixture()
    const withRole = assignRole(state, country1Id, 'chancellor', person1Id)
    const result = revokeRole(withRole, country1Id, 'chancellor')

    expect(result).not.toBe(state)
    expect(result.countries[country1Id]!.roleAssignments).toEqual({})
  })
})
