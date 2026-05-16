import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { changeRulerHouse } from './changeRulerHouse'

function makeFixture({
  rulerHouseLegacyPrestige = 50,
  newRulerLegacyPrestige = 50,
  countryLegacyPrestige = 50,
}: {
  rulerHouseLegacyPrestige?: number
  newRulerLegacyPrestige?: number
  countryLegacyPrestige?: number
} = {}): {
  state: WorldState
  country1Id: CountryId
  house1Id: HouseId
  house2Id: HouseId
} {
  const country1Id = createCountryId('c', 0)
  const country2Id = createCountryId('c', 1)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)

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
        legacyPrestige: countryLegacyPrestige,
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
        memberIds: [],
        headId: createPersonId('pe', 0),
        cadetHouseIds: [],
        legacyPrestige: rulerHouseLegacyPrestige,
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
        legacyPrestige: newRulerLegacyPrestige,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {},
    activePlots: {},
    popGroups: {},
  }
  return { state, country1Id, house1Id, house2Id }
}

function createPersonId(prefix: string, n: number): PersonId {
  return (prefix + '-' + n) as unknown as PersonId
}

describe('changeRulerHouse', () => {
  it('country rulerHouseId is updated', () => {
    const { state, country1Id, house2Id } = makeFixture()
    const result = changeRulerHouse(state, country1Id, house2Id)

    expect(result.countries[country1Id]!.rulerHouseId).toBe(house2Id)
  })

  it('country legacyPrestige decreases by 5', () => {
    const { state, country1Id, house2Id } = makeFixture({ countryLegacyPrestige: 20 })
    const result = changeRulerHouse(state, country1Id, house2Id)

    expect(result.countries[country1Id]!.legacyPrestige).toBe(15)
  })

  it('country legacyPrestige is clamped to 0', () => {
    const { state, country1Id, house2Id } = makeFixture({ countryLegacyPrestige: 3 })
    const result = changeRulerHouse(state, country1Id, house2Id)

    expect(result.countries[country1Id]!.legacyPrestige).toBe(0)
  })

  it('country roleAssignments is reset to empty', () => {
    const { state, country1Id, house2Id } = makeFixture()
    const result = changeRulerHouse(state, country1Id, house2Id)

    expect(result.countries[country1Id]!.roleAssignments).toEqual({})
  })

  it('newRulerHouse legacyPrestige increases by 10', () => {
    const { state, country1Id } = makeFixture({ newRulerLegacyPrestige: 50 })
    const newHouseId = createHouseId('h', 99)
    const stateWithNewHouse: WorldState = {
      ...state,
      houses: {
        ...state.houses,
        [newHouseId]: {
          id: newHouseId,
          name: 'New House',
          active: true,
          countryId: createCountryId('c', 2),
          provinceIds: [],
          memberIds: [],
          headId: createPersonId('pe', 2),
          cadetHouseIds: [],
          legacyPrestige: 50,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
      },
      countries: {
        ...state.countries,
        [createCountryId('c', 2)]: {
          id: createCountryId('c', 2),
          name: 'Country 3',
          rulerHouseId: newHouseId,
          houseIds: [newHouseId],
          treasury: 100,
          legacyPrestige: 50,
          adminPower: 10,
          roleAssignments: {},
          active: true,
          capitalProvinceId: '' as ProvinceId,
        },
      },
    }
    const result = changeRulerHouse(stateWithNewHouse, country1Id, newHouseId)

    expect(result.houses[newHouseId]!.legacyPrestige).toBe(60)
  })

  it('newRulerHouse legacyPrestige is clamped to 100', () => {
    const { state, country1Id } = makeFixture({ newRulerLegacyPrestige: 95 })
    const newHouseId = createHouseId('h', 99)
    const stateWithNewHouse: WorldState = {
      ...state,
      houses: {
        ...state.houses,
        [newHouseId]: {
          id: newHouseId,
          name: 'New House',
          active: true,
          countryId: createCountryId('c', 2),
          provinceIds: [],
          memberIds: [],
          headId: createPersonId('pe', 2),
          cadetHouseIds: [],
          legacyPrestige: 95,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
      },
      countries: {
        ...state.countries,
        [createCountryId('c', 2)]: {
          id: createCountryId('c', 2),
          name: 'Country 3',
          rulerHouseId: newHouseId,
          houseIds: [newHouseId],
          treasury: 100,
          legacyPrestige: 50,
          adminPower: 10,
          roleAssignments: {},
          active: true,
          capitalProvinceId: '' as ProvinceId,
        },
      },
    }
    const result = changeRulerHouse(stateWithNewHouse, country1Id, newHouseId)

    expect(result.houses[newHouseId]!.legacyPrestige).toBe(100)
  })

  it('oldRulerHouse legacyPrestige decreases by 10', () => {
    const { state, country1Id, house1Id, house2Id } = makeFixture({
      rulerHouseLegacyPrestige: 30,
    })
    const result = changeRulerHouse(state, country1Id, house2Id)

    expect(result.houses[house1Id]!.legacyPrestige).toBe(20)
  })

  it('oldRulerHouse legacyPrestige is clamped to 0', () => {
    const { state, country1Id, house1Id, house2Id } = makeFixture({
      rulerHouseLegacyPrestige: 5,
    })
    const result = changeRulerHouse(state, country1Id, house2Id)

    expect(result.houses[house1Id]!.legacyPrestige).toBe(0)
  })

  it('original state is not mutated', () => {
    const { state, country1Id, house2Id } = makeFixture()
    const result = changeRulerHouse(state, country1Id, house2Id)

    expect(result).not.toBe(state)
  })

  it('throws when countryId does not exist', () => {
    const { state } = makeFixture()

    expect(() => changeRulerHouse(state, createCountryId('c', 99), createHouseId('h', 2))).toThrow(
      'Country not found',
    )
  })
})
