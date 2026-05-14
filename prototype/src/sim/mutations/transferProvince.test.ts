import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { transferProvinceToHouse } from './transferProvince'

function makeFixture(): {
  state: WorldState
  provinceId: ProvinceId
  house1Id: HouseId
  house2Id: HouseId
  country1Id: CountryId
  country2Id: CountryId
  person1Id: PersonId
  person2Id: PersonId
} {
  const provinceId = createProvinceId('p', 0)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const country1Id = createCountryId('c', 0)
  const country2Id = createCountryId('c', 1)
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {
      [provinceId]: {
        id: provinceId,
        name: 'Test Province',
        x: 0,
        y: 0,
        neighbors: [],
        ownerHouseId: house1Id,
        countryId: country1Id,
        baseTax: 5,
        manpower: 5,
        unrest: 0,
        development: 0,
        countryControl: 100,
        houseControl: 100,
      },
    },
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
        provinceIds: [provinceId],
        memberIds: [],
        headId: person1Id,
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
        prestige: 50,
        cohesion: 50,
        loyaltyToCountry: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {},
    activePlots: {},
  }
  return {
    state,
    provinceId,
    house1Id,
    house2Id,
    country1Id,
    country2Id,
    person1Id,
    person2Id,
  }
}

describe('transferProvinceToHouse', () => {
  it('Province ownerHouseId and countryId are updated correctly', () => {
    const { state, provinceId, house2Id, country2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.provinces[provinceId]!.ownerHouseId).toBe(house2Id)
    expect(result.provinces[provinceId]!.countryId).toBe(country2Id)
  })

  it('old house provinceIds no longer contains the provinceId', () => {
    const { state, provinceId, house1Id, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.houses[house1Id]!.provinceIds).not.toContain(provinceId)
  })

  it('new house provinceIds contains the provinceId', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.houses[house2Id]!.provinceIds).toContain(provinceId)
  })

  it('original state is not mutated', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result).not.toBe(state)
  })

  it('throws when provinceId does not exist', () => {
    const { state } = makeFixture()

    expect(() =>
      transferProvinceToHouse(state, createProvinceId('p', 99), createHouseId('h', 2)),
    ).toThrow('Province not found')
  })

  it('throws when newOwnerHouseId does not exist', () => {
    const { state, provinceId } = makeFixture()

    expect(() => transferProvinceToHouse(state, provinceId, createHouseId('h', 99))).toThrow(
      'New owner house not found',
    )
  })
})
