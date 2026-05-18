import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createHouse, deactivateHouse, addHouseWealth } from './houseMutations'

function makeFixture(): {
  state: WorldState
  polity1Id: PolityId
  house1Id: HouseId
  provinceId: ProvinceId
} {
  const polity1Id = createPolityId('c', 0)
  const house1Id = createHouseId('h', 0)
  const provinceId = createProvinceId('p', 0)

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
        polityId: polity1Id,
        habitability: 50,
        development: 10,
        polityControl: 100,
        houseControl: 100,
        popGroupIds: [],
      },
    },
    polities: {
      [polity1Id]: {
        id: polity1Id,
        name: 'Polity 1',
        rank: 2,
        ownerHouseId: house1Id,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: provinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        name: 'House 1',
        active: true,
        provinceIds: [provinceId],
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: provinceId,
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
  return { state, polity1Id, house1Id, provinceId }
}

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

describe('createHouse', () => {
  it('creates a house with correct initial values', () => {
    const { state, polity1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, { name: 'New House', polityId: polity1Id })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newHouse = result.value.ctx.state.houses[houseId]
    expect(newHouse).toBeDefined()
    expect(newHouse!.name).toBe('New House')
    expect(newHouse!.active).toBe(true)
    expect(newHouse!.memberIds).toEqual([])
  })

  it('updates parent house cadetHouseIds when parentHouseId is given', () => {
    const { state, polity1Id, house1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, {
      name: 'Cadet House',
      polityId: polity1Id,
      parentHouseId: house1Id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newState = result.value.ctx.state
    expect(newState.houses[house1Id]!.cadetHouseIds).toContain(houseId)
  })

  it('returns err when polity not found', () => {
    const { state } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, { name: 'X', polityId: createPolityId('c', 99) })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('POLITY_NOT_FOUND')
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

  it('returns err when house not found', () => {
    const { state } = makeFixture()
    const result = deactivateHouse(state, createHouseId('h', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

describe('addHouseWealth', () => {
  it('adds delta to house wealth', () => {
    const { state, house1Id } = makeFixture()
    const result = addHouseWealth(state, house1Id, 75)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.houses[house1Id]!.wealth).toBe(75)
  })

  it('floors at 0 for negative delta larger than wealth', () => {
    const { state, house1Id } = makeFixture()
    const result = addHouseWealth(state, house1Id, -200)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.houses[house1Id]!.wealth).toBe(0)
  })

  it('returns err when house not found', () => {
    const { state } = makeFixture()
    const result = addHouseWealth(state, createHouseId('h', 99), 10)
    expect(result.ok).toBe(false)
  })
})
