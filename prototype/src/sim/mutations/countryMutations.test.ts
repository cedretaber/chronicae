import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { collectIntegrityErrors } from '../tick/integritySystem'
import { moveHouseToCountry, createCountry, deactivateCountry } from './countryMutations'

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
        habitability: 50,
        popGroupIds: [],
        development: 0,
        countryControl: 100,
        houseControl: 100,
      },
    },
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
      [country2Id]: {
        id: country2Id,
        name: 'Country 2',
        houseIds: [house2Id],
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
        provinceIds: [provinceId],
        memberIds: [person1Id],
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
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 50,
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
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 50,
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
  return { state, house1Id, house2Id, country1Id, country2Id, provinceId, person1Id }
}

describe('moveHouseToCountry', () => {
  it('House countryId is updated', () => {
    const { state, house1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.houses[house1Id]!.countryId).toBe(country2Id)
  })

  it('Old country houseIds no longer contains the houseId', () => {
    const { state, house1Id, country1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.countries[country1Id]!.houseIds).not.toContain(house1Id)
  })

  it('New country houseIds contains the houseId', () => {
    const { state, house1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.countries[country2Id]!.houseIds).toContain(house1Id)
  })

  it('All provinces owned by the house have updated countryId', () => {
    const { state, house1Id, provinceId, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.provinces[provinceId]!.countryId).toBe(country2Id)
  })

  it('All persons in the house have updated countryId', () => {
    const { state, house1Id, person1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person1Id]!.countryId).toBe(country2Id)
  })

  it('Original state is not mutated', () => {
    const { state, house1Id, country2Id } = makeFixture()
    const result = moveHouseToCountry(state, house1Id, country2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).not.toBe(state)
  })

  it('returns err when houseId does not exist', () => {
    const { state } = makeFixture()
    const result = moveHouseToCountry(state, createHouseId('h', 99), createCountryId('c', 2))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextCountryIndex: 10,
  }
}

describe('createCountry', () => {
  it('creates a country with correct initial values', () => {
    const { state } = makeFixture()
    const ctx = makeCtx(state)
    const result = createCountry(ctx, { name: 'New Country', treasury: 200, legacyPrestige: 30 })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { countryId } = result.value.value
    const newCountry = result.value.ctx.state.countries[countryId]
    expect(newCountry).toBeDefined()
    expect(newCountry!.name).toBe('New Country')
    expect(newCountry!.treasury).toBe(200)
    expect(newCountry!.legacyPrestige).toBe(30)
    expect(newCountry!.active).toBe(true)
    expect(newCountry!.houseIds).toEqual([])
    expect(collectIntegrityErrors(result.value.ctx.state)).toEqual([])
  })

  it('allocates a unique dc- prefixed countryId', () => {
    const { state } = makeFixture()
    const ctx = makeCtx(state)
    const result = createCountry(ctx, { name: 'Country X' })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { countryId } = result.value.value
    expect((countryId as string).startsWith('dc-')).toBe(true)
  })
})

describe('deactivateCountry', () => {
  it('marks country as inactive', () => {
    const { state, country1Id } = makeFixture()
    const result = deactivateCountry(state, country1Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.countries[country1Id]!.active).toBe(false)
  })

  it('is a no-op when already inactive', () => {
    const { state, country1Id } = makeFixture()
    const first = deactivateCountry(state, country1Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const result = deactivateCountry(first.value, country1Id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(first.value)
  })

  it('deactivates all houses when deactivateHouses is true', () => {
    const { state, country1Id, house1Id } = makeFixture()
    const result = deactivateCountry(state, country1Id, { deactivateHouses: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.countries[country1Id]!.active).toBe(false)
      expect(result.value.houses[house1Id]!.active).toBe(false)
    }
  })

  it('returns err when country not found', () => {
    const { state } = makeFixture()
    const result = deactivateCountry(state, createCountryId('c', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('COUNTRY_NOT_FOUND')
  })
})
