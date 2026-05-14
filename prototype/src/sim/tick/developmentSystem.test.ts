import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { ProvinceId, HouseId, CountryId, PersonId } from '../types/ids'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runDevelopmentSystem } from './developmentSystem'

function makeProvinceState(development: number): WorldState {
  const provinceId = 'p-0' as ProvinceId
  const houseId = 'h-0' as HouseId
  const countryId = 'c-0' as CountryId
  const headId = 'pe-0' as PersonId

  return {
    currentYear: 1,
    currentMonth: 1,
    provinces: {
      [provinceId]: {
        id: provinceId,
        name: 'P0',
        x: 0,
        y: 0,
        neighbors: [],
        ownerHouseId: houseId,
        countryId,
        baseTax: 5,
        manpower: 5,
        unrest: 0,
        development,
        countryControl: 100,
        houseControl: 100,
      },
    },
    countries: {
      [countryId]: {
        id: countryId,
        name: 'C0',
        rulerHouseId: houseId,
        houseIds: [houseId],
        treasury: 100,
        legitimacy: 70,
        adminPower: 50,
        stability: 60,
        roleAssignments: {},
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [houseId]: {
        id: houseId,
        name: 'H0',
        active: true,
        countryId,
        provinceIds: [provinceId],
        memberIds: [],
        headId,
        prestige: 50,
        cohesion: 60,
        loyaltyToCountry: 70,
        wealth: 100,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {},
    activePlots: {},
  }
}

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
  }
}

describe('runDevelopmentSystem', () => {
  it('positive development decays toward 0 by developmentPositiveMonthlyDecay per month', () => {
    const world = makeProvinceState(10)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    expect(result.state.provinces['p-0' as ProvinceId]!.development).toBe(9.9)
  })

  it('negative development recovers toward 0 by developmentNegativeMonthlyRecovery per month', () => {
    const world = makeProvinceState(-10)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    expect(result.state.provinces['p-0' as ProvinceId]!.development).toBe(-9.75)
  })

  it('development = 0 stays at 0', () => {
    const world = makeProvinceState(0)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    expect(result.state.provinces['p-0' as ProvinceId]!.development).toBe(0)
  })

  it('positive development does NOT go below 0', () => {
    const world = makeProvinceState(0.05)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    expect(result.state.provinces['p-0' as ProvinceId]!.development).toBe(0)
  })

  it('negative development does NOT go above 0', () => {
    const world = makeProvinceState(-0.1)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    expect(result.state.provinces['p-0' as ProvinceId]!.development).toBe(0)
  })

  it('original state is not mutated (immutability)', () => {
    const world = makeProvinceState(10)
    const originalProvinces = world.provinces
    const originalProvince = world.provinces['p-0' as ProvinceId]

    const ctx = makeCtx(world)
    runDevelopmentSystem(ctx)

    expect(world.provinces).toBe(originalProvinces)
    expect(world.provinces['p-0' as ProvinceId]).toBe(originalProvince)
  })
})
