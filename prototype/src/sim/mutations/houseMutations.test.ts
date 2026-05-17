import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId } from '../types/ids'
import type { CountryId, HouseId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { collectIntegrityErrors } from '../tick/integritySystem'
import { createHouse, deactivateHouse } from './houseMutations'

function makeFixture(): { state: WorldState; country1Id: CountryId; house1Id: HouseId } {
  const country1Id = createCountryId('c', 0)
  const house1Id = createHouseId('h', 0)

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
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {},
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  }
  return { state, country1Id, house1Id }
}

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

describe('createHouse', () => {
  it('creates a house with correct initial values', () => {
    const { state, country1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, { name: 'New House', countryId: country1Id })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newHouse = result.value.ctx.state.houses[houseId]
    expect(newHouse).toBeDefined()
    expect(newHouse!.name).toBe('New House')
    expect(newHouse!.countryId).toBe(country1Id)
    expect(newHouse!.active).toBe(true)
    expect(newHouse!.memberIds).toEqual([])
    expect(collectIntegrityErrors(result.value.ctx.state)).toEqual([])
  })

  it('adds the new house to the country houseIds', () => {
    const { state, country1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, { name: 'New House', countryId: country1Id })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newState = result.value.ctx.state
    expect(newState.countries[country1Id]!.houseIds).toContain(houseId)
  })

  it('updates parent house cadetHouseIds when parentHouseId is given', () => {
    const { state, country1Id, house1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, {
      name: 'Cadet House',
      countryId: country1Id,
      parentHouseId: house1Id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newState = result.value.ctx.state
    expect(newState.houses[house1Id]!.cadetHouseIds).toContain(houseId)
  })

  it('returns err when country not found', () => {
    const { state } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, { name: 'X', countryId: createCountryId('c', 99) })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('COUNTRY_NOT_FOUND')
  })
})

describe('deactivateHouse', () => {
  it('marks house as inactive', () => {
    const { state, house1Id } = makeFixture()
    const result = deactivateHouse(state, house1Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.houses[house1Id]!.active).toBe(false)
  })

  it('is a no-op when already inactive', () => {
    const { state, house1Id } = makeFixture()
    const first = deactivateHouse(state, house1Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const result = deactivateHouse(first.value, house1Id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(first.value)
  })

  it('removes from country houseIds when removeFromCountry is true', () => {
    const { state, house1Id, country1Id } = makeFixture()
    const result = deactivateHouse(state, house1Id, { removeFromCountry: true })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.countries[country1Id]!.houseIds).not.toContain(house1Id)
    }
  })

  it('returns err when house not found', () => {
    const { state } = makeFixture()
    const result = deactivateHouse(state, createHouseId('h', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})
