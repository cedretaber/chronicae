import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createProvinceId } from '../types/ids'
import type { CountryId, HouseId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { collectIntegrityErrors } from '../tick/integritySystem'
import {
  transferProvinceToHouse,
  transferProvinceToCountry,
  adjustProvinceDevelopment,
} from './provinceMutations'

function makeFixture(): {
  state: WorldState
  provinceId: ProvinceId
  house1Id: HouseId
  house2Id: HouseId
  country1Id: CountryId
  country2Id: CountryId
} {
  const provinceId = createProvinceId('p', 0)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const country1Id = createCountryId('c', 0)
  const country2Id = createCountryId('c', 1)

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
        memberIds: [],
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
  return { state, provinceId, house1Id, house2Id, country1Id, country2Id }
}

describe('transferProvinceToHouse', () => {
  it('Province ownerHouseId and countryId are updated correctly', () => {
    const { state, provinceId, house2Id, country2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.provinces[provinceId]!.ownerHouseId).toBe(house2Id)
      expect(result.value.provinces[provinceId]!.countryId).toBe(country2Id)
    }
  })

  it('old house provinceIds no longer contains the provinceId', () => {
    const { state, provinceId, house1Id, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.houses[house1Id]!.provinceIds).not.toContain(provinceId)
  })

  it('new house provinceIds contains the provinceId', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.houses[house2Id]!.provinceIds).toContain(provinceId)
  })

  it('original state is not mutated', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).not.toBe(state)
  })

  it('returns err when provinceId does not exist', () => {
    const { state } = makeFixture()
    const result = transferProvinceToHouse(state, createProvinceId('p', 99), createHouseId('h', 2))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PROVINCE_NOT_FOUND')
  })

  it('returns err when newOwnerHouseId does not exist', () => {
    const { state, provinceId } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, createHouseId('h', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

describe('transferProvinceToCountry', () => {
  it('transfers province to a house within the target country', () => {
    const { state, provinceId, house2Id, country2Id } = makeFixture()
    const result = transferProvinceToCountry(state, provinceId, country2Id, house2Id)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.provinces[provinceId]!.ownerHouseId).toBe(house2Id)
    expect(result.value.provinces[provinceId]!.countryId).toBe(country2Id)
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('returns err when province not found', () => {
    const { state, house2Id, country2Id } = makeFixture()
    const result = transferProvinceToCountry(state, createProvinceId('p', 99), country2Id, house2Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PROVINCE_NOT_FOUND')
  })

  it('returns err when target country not found', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToCountry(state, provinceId, createCountryId('c', 99), house2Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('COUNTRY_NOT_FOUND')
  })

  it('returns err when house does not belong to target country', () => {
    const { state, provinceId, house1Id, country2Id } = makeFixture()
    const result = transferProvinceToCountry(state, provinceId, country2Id, house1Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CROSS_COUNTRY_TRANSFER')
  })
})

describe('transferProvinceToHouse with newHouseControl', () => {
  it('overrides houseControl when newHouseControl is provided', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id, { newHouseControl: 42 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.provinces[provinceId]!.houseControl).toBe(42)
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('preserves original houseControl when option is omitted', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const original = state.provinces[provinceId]!.houseControl
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.provinces[provinceId]!.houseControl).toBe(original)
  })
})

describe('adjustProvinceDevelopment', () => {
  it('adds delta to development', () => {
    const { state, provinceId } = makeFixture()
    const result = adjustProvinceDevelopment(state, provinceId, 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.provinces[provinceId]!.development).toBe(10)
  })

  it('clamps to -100..100 by default', () => {
    const { state, provinceId } = makeFixture()
    const r1 = adjustProvinceDevelopment(state, provinceId, 200)
    const r2 = adjustProvinceDevelopment(state, provinceId, -200)

    expect(r1.ok && r1.value.provinces[provinceId]!.development).toBe(100)
    expect(r2.ok && r2.value.provinces[provinceId]!.development).toBe(-100)
  })

  it('respects custom min/max options', () => {
    const { state, provinceId } = makeFixture()
    const result = adjustProvinceDevelopment(state, provinceId, 50, { min: -50, max: 30 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.provinces[provinceId]!.development).toBe(30)
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('returns err when province not found', () => {
    const { state } = makeFixture()
    const result = adjustProvinceDevelopment(state, createProvinceId('p', 99), 10)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PROVINCE_NOT_FOUND')
  })
})
