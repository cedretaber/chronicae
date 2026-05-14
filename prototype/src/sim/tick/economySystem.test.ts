import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { ProvinceId, HouseId, CountryId, PersonId } from '../types/ids'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runEconomySystem } from './economySystem'

function makeEconomyState(baseTax: number, unrest: number, development: number = 0): WorldState {
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
        baseTax,
        manpower: 5,
        unrest,
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
        headId: headId,
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

describe('runEconomySystem', () => {
  it('unrest=0, both controls=100: equal 50/50 split', () => {
    const baseTax = 10
    const world = makeEconomyState(baseTax, 0)
    const ctx = makeCtx(world)

    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house).toBeDefined()
    expect(house?.wealth).toBe(105)

    const country = result.state.countries['c-0' as CountryId]
    expect(country).toBeDefined()
    expect(country?.treasury).toBe(105)
  })

  it('unrest=100: no income (effectiveTax=0)', () => {
    const baseTax = 10
    const world = makeEconomyState(baseTax, 100)
    const ctx = makeCtx(world)

    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBe(100)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBe(100)
  })

  it('unrest=50, both controls=100: half income split 50/50', () => {
    const baseTax = 10
    const world = makeEconomyState(baseTax, 50)
    const ctx = makeCtx(world)

    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBe(102.5)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBe(102.5)
  })

  it('wealth never goes below 0', () => {
    const provinceId = 'p-0' as ProvinceId
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const headId = 'pe-0' as PersonId

    const world = {
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
          baseTax: 10,
          manpower: 5,
          unrest: 0,
          development: 0,
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
          headId: headId,
          prestige: 50,
          cohesion: 60,
          loyaltyToCountry: 70,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
      },
      persons: {},
      activePlots: {},
    } as WorldState

    const ctx = makeCtx(world)
    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]!
    expect(house?.wealth).toBeGreaterThanOrEqual(0)
  })

  it('original state is not mutated (immutability)', () => {
    const baseTax = 10
    const world = makeEconomyState(baseTax, 0)
    const originalWealth = world.houses['h-0' as HouseId]!.wealth
    const originalTreasury = world.countries['c-0' as CountryId]!.treasury
    const originalProvinces = world.provinces
    const originalCountries = world.countries
    const originalHouses = world.houses

    const ctx = makeCtx(world)
    runEconomySystem(ctx)

    expect(world.houses['h-0' as HouseId]!.wealth).toBe(originalWealth)
    expect(world.countries['c-0' as CountryId]!.treasury).toBe(originalTreasury)
    expect(world.provinces).toBe(originalProvinces)
    expect(world.countries).toBe(originalCountries)
    expect(world.houses).toBe(originalHouses)
  })

  it('development=-100: income is 0 (development multiplier = 0)', () => {
    const baseTax = 10
    const world = makeEconomyState(baseTax, 0, -100)
    const ctx = makeCtx(world)

    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBe(100)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBe(100)
  })

  it('development=100, both controls=100: double income split 50/50', () => {
    const baseTax = 10
    const world = makeEconomyState(baseTax, 0, 100)
    const ctx = makeCtx(world)

    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBe(110)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBe(110)
  })

  it('unrest=50, development=50, both controls=100: combined effect', () => {
    const baseTax = 10
    const world = makeEconomyState(baseTax, 50, 50)
    const ctx = makeCtx(world)

    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBeCloseTo(103.75, 1)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBeCloseTo(103.75, 1)
  })

  it('countryControl=100, houseControl=0: country gets all income', () => {
    const baseTax = 10
    const baseWorld = makeEconomyState(baseTax, 0)
    const world: WorldState = {
      ...baseWorld,
      provinces: {
        ...baseWorld.provinces,
        ['p-0' as ProvinceId]: {
          ...baseWorld.provinces['p-0' as ProvinceId]!,
          countryControl: 100,
          houseControl: 0,
        },
      },
    }
    const ctx = makeCtx(world)
    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBe(100)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBe(110)
  })

  it('countryControl=0, houseControl=100: house gets all income', () => {
    const baseTax = 10
    const baseWorld = makeEconomyState(baseTax, 0)
    const world: WorldState = {
      ...baseWorld,
      provinces: {
        ...baseWorld.provinces,
        ['p-0' as ProvinceId]: {
          ...baseWorld.provinces['p-0' as ProvinceId]!,
          countryControl: 0,
          houseControl: 100,
        },
      },
    }
    const ctx = makeCtx(world)
    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBe(110)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBe(100)
  })

  it('countryControl=0, houseControl=0: no income', () => {
    const baseTax = 10
    const baseWorld = makeEconomyState(baseTax, 0)
    const world: WorldState = {
      ...baseWorld,
      provinces: {
        ...baseWorld.provinces,
        ['p-0' as ProvinceId]: {
          ...baseWorld.provinces['p-0' as ProvinceId]!,
          countryControl: 0,
          houseControl: 0,
        },
      },
    }
    const ctx = makeCtx(world)
    const result = runEconomySystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.wealth).toBe(100)

    const country = result.state.countries['c-0' as CountryId]
    expect(country?.treasury).toBe(100)
  })
})
