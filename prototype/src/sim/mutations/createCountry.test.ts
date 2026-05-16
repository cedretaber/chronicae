import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { createCountryFromHouse } from './createCountry'

function makeFixture(): {
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
        houseIds: [house1Id, house2Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 50,
        roleAssignments: {},
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
      [country2Id]: {
        id: country2Id,
        name: 'Country 2',
        rulerHouseId: createHouseId('h', 2),
        houseIds: [],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 50,
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
        wealth: 1000,
        seatProvinceId: '' as ProvinceId,
      },
      [house2Id]: {
        id: house2Id,
        name: 'House 2',
        active: true,
        countryId: country1Id,
        provinceIds: [],
        memberIds: [],
        headId: createPersonId('pe', 1),
        cadetHouseIds: [],
        legacyPrestige: 30,
        wealth: 200,
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
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 50,
        attitudes: {},
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

describe('createCountryFromHouse', () => {
  it('creates new country with correct initial values', () => {
    const { state, house1Id } = makeFixture()
    const newCountryId = createCountryId('c', 10)

    const result = createCountryFromHouse(state, house1Id, newCountryId)

    const newCountry = result.countries[newCountryId]
    expect(newCountry).toBeDefined()
    expect(newCountry!.legacyPrestige).toBe(20)
    expect(newCountry!.adminPower).toBe(0)
    expect(newCountry!.name).toBe('House 1領')
    expect(newCountry!.treasury).toBe(Math.floor(1000 * 0.5))
    expect(newCountry!.rulerHouseId).toBe(house1Id)
  })

  it('rebel house moves to new country', () => {
    const { state, house1Id, country1Id } = makeFixture()
    const newCountryId = createCountryId('c', 10)

    const result = createCountryFromHouse(state, house1Id, newCountryId)

    expect(result.houses[house1Id]!.countryId).toBe(newCountryId)
    expect(result.countries[country1Id]!.houseIds).not.toContain(house1Id)
  })

  it('old country receives penalties', () => {
    const { state, house1Id, country1Id } = makeFixture()
    const newCountryId = createCountryId('c', 10)

    const oldCountry = state.countries[country1Id]!
    const oldLegacyPrestige = oldCountry.legacyPrestige
    const oldAdminPower = oldCountry.adminPower

    const result = createCountryFromHouse(state, house1Id, newCountryId)

    const updatedOldCountry = result.countries[country1Id]!
    expect(updatedOldCountry.legacyPrestige).toBe(Math.max(0, oldLegacyPrestige - 10))
    expect(updatedOldCountry.adminPower).toBe(Math.max(0, oldAdminPower - 5))
  })

  it('returns state unchanged if rebelHouseId not found', () => {
    const { state } = makeFixture()
    const fakeHouseId = createHouseId('h', 999)

    const result = createCountryFromHouse(state, fakeHouseId, createCountryId('c', 10))

    expect(result).toBe(state)
  })
})
