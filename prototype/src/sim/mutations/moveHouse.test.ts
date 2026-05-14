import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { moveHouseToCountry } from './moveHouse'

function makeFixture(): {
  state: WorldState
  house1Id: HouseId
  house2Id: HouseId
  country1Id: CountryId
  country2Id: CountryId
  provinceId: ProvinceId
  person1Id: PersonId
} {
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const country1Id = createCountryId('c', 0)
  const country2Id = createCountryId('c', 1)
  const provinceId = createProvinceId('p', 0)
  const person1Id = createPersonId('pe', 0)

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
        memberIds: [person1Id],
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
        headId: createPersonId('pe', 1),
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
        age: 30,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
        prestige: 50,
      },
    },
    activePlots: {},
  }
  return {
    state,
    house1Id,
    house2Id,
    country1Id,
    country2Id,
    provinceId,
    person1Id,
  }
}

describe('moveHouseToCountry', () => {
  it('House countryId is updated', () => {
    const { state, house1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.houses[house1Id]!.countryId).toBe(country2Id)
  })

  it('Old country houseIds no longer contains the houseId', () => {
    const { state, house1Id, country1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.countries[country1Id]!.houseIds).not.toContain(house1Id)
  })

  it('New country houseIds contains the houseId', () => {
    const { state, house1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.countries[country2Id]!.houseIds).toContain(house1Id)
  })

  it('All provinces owned by the house have updated countryId', () => {
    const { state, house1Id, provinceId, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.provinces[provinceId]!.countryId).toBe(country2Id)
  })

  it('All persons in the house have updated countryId', () => {
    const { state, house1Id, person1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.persons[person1Id]!.countryId).toBe(country2Id)
  })

  it('Original state is not mutated', () => {
    const { state, house1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result).not.toBe(state)
  })

  it('Throws when houseId does not exist', () => {
    const { state } = makeFixture()

    expect(() =>
      moveHouseToCountry(state, createHouseId('h', 99), createCountryId('c', 2)),
    ).toThrow('House not found')
  })
})
