import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { setHouseHead } from './houseMutations'

function makeFixture(): {
  state: WorldState
  house1Id: HouseId
  person1Id: PersonId
  person2Id: PersonId
  country1Id: CountryId
} {
  const house1Id = createHouseId('h', 0)
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)
  const country1Id = createCountryId('c', 0)

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
        memberIds: [person1Id, person2Id],
        headId: person1Id,
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
        sex: 'male' as const,
        age: 30,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        childIds: [],
        birthStatus: 'legitimate' as const,
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
        prestige: 10,
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
        traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
        prestige: 10,
      },
    },
    activePlots: {},
    popGroups: {},
  }
  return { state, house1Id, person1Id, person2Id, country1Id }
}

describe('setHouseHead', () => {
  it('sets headId on the house', () => {
    const { state, house1Id, person2Id } = makeFixture()
    const result = setHouseHead(state, house1Id, person2Id)

    expect(result.houses[house1Id]!.headId).toBe(person2Id)
  })

  it('returns new state (immutability: original state.houses unchanged)', () => {
    const { state, house1Id, person2Id } = makeFixture()
    const result = setHouseHead(state, house1Id, person2Id)

    expect(result).not.toBe(state)
    expect(result.houses[house1Id]!.headId).toBe(person2Id)
    expect(state.houses[house1Id]!.headId).not.toBe(person2Id)
  })

  it('throws when house not found', () => {
    const { state } = makeFixture()

    expect(() => setHouseHead(state, createHouseId('h', 99), createPersonId('pe', 0))).toThrow(
      'setHouseHead: house not found: h-99',
    )
  })
})
