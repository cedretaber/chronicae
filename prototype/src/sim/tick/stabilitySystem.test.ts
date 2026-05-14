import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, ProvinceId } from '../types/ids'
import type { Country } from '../types/country'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { runStabilitySystem } from './stabilitySystem'

function makeCtx(
  stability: number,
  legitimacy: number,
  additionalCountries: Record<CountryId, { stability: number; legitimacy: number }> = {},
): TickContext {
  const country1Id = createCountryId('c', 0)
  const house1Id = createHouseId('h', 0)
  const person1Id = createPersonId('pe', 0)

  const countries: Record<CountryId, Country> = {
    [country1Id]: {
      id: country1Id,
      name: 'C0',
      rulerHouseId: house1Id,
      houseIds: [house1Id],
      treasury: 100,
      legitimacy,
      adminPower: 50,
      stability,
      roleAssignments: {},
      active: true,
      capitalProvinceId: '' as ProvinceId,
    },
  }

  for (const [id, vals] of Object.entries(additionalCountries)) {
    countries[id as CountryId] = {
      id: id as CountryId,
      name: 'Extra',
      rulerHouseId: createHouseId('h', 99),
      houseIds: [],
      treasury: 100,
      legitimacy: vals.legitimacy,
      adminPower: 50,
      stability: vals.stability,
      roleAssignments: {},
      active: true,
      capitalProvinceId: '' as ProvinceId,
    }
  }

  const state: WorldState = {
    currentYear: 1,
    currentMonth: 1,
    provinces: {},
    countries,
    houses: {
      [house1Id]: {
        id: house1Id,
        name: 'H0',
        active: true,
        countryId: country1Id,
        provinceIds: [],
        memberIds: [person1Id],
        headId: person1Id,
        cadetHouseIds: [],
        prestige: 50,
        cohesion: 60,
        loyaltyToCountry: 70,
        wealth: 100,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [person1Id]: {
        id: person1Id,
        name: 'P0',
        sex: 'male',
        age: 30,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        childIds: [],
        birthStatus: 'unknown',
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
        prestige: 10,
      },
    },
    activePlots: {},
  }

  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
  }
}

describe('runStabilitySystem', () => {
  it('increases stability by 0.2 each tick', () => {
    const ctx = makeCtx(50.0, 50.0)
    const result = runStabilitySystem(ctx)

    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.stability).toBe(50.2)
    expect(country.legitimacy).toBe(50.05)
  })

  it('clamps stability at 100', () => {
    const ctx = makeCtx(99.9, 99.98)
    const result = runStabilitySystem(ctx)

    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.stability).toBe(100)
    expect(country.legitimacy).toBe(100)
  })

  it('processes all countries', () => {
    const country2Id = createCountryId('c', 1)
    const ctx = makeCtx(50.0, 50.0, {
      [country2Id]: { stability: 60.0, legitimacy: 70.0 },
    })
    const result = runStabilitySystem(ctx)

    const c0 = result.state.countries[createCountryId('c', 0)]!
    const c1 = result.state.countries[country2Id]!
    expect(c0.stability).toBe(50.2)
    expect(c0.legitimacy).toBe(50.05)
    expect(c1.stability).toBe(60.2)
    expect(c1.legitimacy).toBe(70.05)
  })
})
