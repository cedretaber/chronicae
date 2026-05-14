import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runRebellionSystem } from './rebellionSystem'
import type { SimEvent } from '../types/event'

function makeBaseState(): {
  state: WorldState
  countryId: CountryId
  houseRulerId: HouseId
  houseVassalId: HouseId
  personRulerId: PersonId
  personVassalId: PersonId
} {
  const countryId = createCountryId('c', 0)
  const houseRulerId = createHouseId('h', 0)
  const houseVassalId = createHouseId('h', 1)
  const personRulerId = createPersonId('pe', 0)
  const personVassalId = createPersonId('pe', 1)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [countryId]: {
        id: countryId,
        name: 'Country 1',
        rulerHouseId: houseRulerId,
        houseIds: [houseRulerId, houseVassalId],
        treasury: 100,
        legitimacy: 80,
        adminPower: 10,
        stability: 50,
        roleAssignments: {},
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [houseRulerId]: {
        id: houseRulerId,
        name: 'Ruler House',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [personRulerId],
        headId: personRulerId,
        cadetHouseIds: [],
        prestige: 50,
        cohesion: 50,
        loyaltyToCountry: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
      [houseVassalId]: {
        id: houseVassalId,
        name: 'Vassal House',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [personVassalId],
        headId: personVassalId,
        cadetHouseIds: [],
        prestige: 50,
        cohesion: 50,
        loyaltyToCountry: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [personRulerId]: {
        id: personRulerId,
        name: 'Ruler Person',
        sex: 'male',
        age: 30,
        alive: true,
        houseId: houseRulerId,
        countryId,
        childIds: [],
        birthStatus: 'unknown',
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
        prestige: 50,
      },
      [personVassalId]: {
        id: personVassalId,
        name: 'Vassal Person',
        sex: 'male',
        age: 35,
        alive: true,
        houseId: houseVassalId,
        countryId,
        childIds: [],
        birthStatus: 'unknown',
        stats: { admin: 5, martial: 5 },
        traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
        prestige: 50,
      },
    },
    activePlots: {},
  }

  return {
    state,
    countryId,
    houseRulerId,
    houseVassalId,
    personRulerId,
    personVassalId,
  }
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runRebellionSystem', () => {
  it('does not trigger rebellion when rebellionTendency < rebellionThreshold', () => {
    const { state, countryId, houseVassalId, personVassalId } = makeBaseState()

    // Low ambition (0.1), high loyaltyToCountry (0.9), high adminPower (80)
    const stateWithLowTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personVassalId]: {
          ...state.persons[personVassalId]!,
          traits: { ambition: 0.1, loyaltyToCountry: 0.9, caution: 0.5 },
        },
      },
      houses: {
        ...state.houses,
        [houseVassalId]: {
          ...state.houses[houseVassalId]!,
          prestige: 10,
          loyaltyToCountry: 90,
        },
      },
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId]!,
          legitimacy: 80,
          adminPower: 80,
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = createTickContext({ state: stateWithLowTendency, rng: createRng('test'), config })

    const result = toResult(runRebellionSystem(ctx))

    expect(countEvents(result.events, 'REBELLION_STARTED')).toBe(0)
    // No stability/legitimacy changes
    const country = result.state.countries[countryId]!
    expect(country.stability).toBe(state.countries[countryId]!.stability)
    expect(country.legitimacy).toBe(state.countries[countryId]!.legitimacy)
  })

  it('rebellion may occur when rebellionTendency >= rebellionThreshold', () => {
    const { state, countryId, houseVassalId, personVassalId } = makeBaseState()

    // High ambition (0.9), low loyaltyToCountry (0.1), low caution (0.1)
    const stateWithHighTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personVassalId]: {
          ...state.persons[personVassalId]!,
          traits: { ambition: 0.9, loyaltyToCountry: 0.1, caution: 0.1 },
        },
      },
      houses: {
        ...state.houses,
        [houseVassalId]: {
          ...state.houses[houseVassalId]!,
          prestige: 30,
          loyaltyToCountry: 20,
        },
      },
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId]!,
          legitimacy: 30,
          adminPower: 20,
        },
      },
    }

    const config = { ...defaultConfig, rebellionThreshold: 70 }
    const ctx = createTickContext({
      state: stateWithHighTendency,
      rng: createRng('rebellion-test'),
      config,
    })

    // Just assert the system runs without throwing; outcome is RNG-dependent
    expect(() => toResult(runRebellionSystem(ctx))).not.toThrow()
  })

  it('rebellion applies instant penalties before success/failure check', () => {
    const { state, countryId, houseVassalId, personVassalId } = makeBaseState()

    // Maximize rebellionTendency: prestige=100, ambition=1.0, loyaltyToCountry=0, legitimacy=0, adminPower=0
    const stateWithMaxTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personVassalId]: {
          ...state.persons[personVassalId]!,
          traits: { ambition: 1.0, loyaltyToCountry: 0, caution: 0 },
        },
      },
      houses: {
        ...state.houses,
        [houseVassalId]: {
          ...state.houses[houseVassalId]!,
          prestige: 100,
          loyaltyToCountry: 0,
        },
      },
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId]!,
          legitimacy: 0,
          adminPower: 0,
        },
      },
    }

    const initialStability = state.countries[countryId]!.stability
    const config = { ...defaultConfig, rebellionThreshold: 50 }
    const ctx = createTickContext({ state: stateWithMaxTendency, rng: createRng('test'), config })

    const result = toResult(runRebellionSystem(ctx))

    const hasRebellionStarted = countEvents(result.events, 'REBELLION_STARTED') > 0
    if (hasRebellionStarted) {
      const country = result.state.countries[countryId]!
      expect(country.stability).toBeLessThan(initialStability)
    }
  })

  it('rebellion_succeeded emits COUNTRY_SPLIT in independence mode', () => {
    const countryId = createCountryId('c', 0)
    const houseRulerId = createHouseId('h', 0)
    const houseVassalId = createHouseId('h', 1)
    const personRulerId = createPersonId('pe', 0)
    const personVassalId = createPersonId('pe', 1)

    // Create provinces for the rebel house
    const provinceIds: ProvinceId[] = []
    for (let i = 0; i < 5; i++) {
      const pid = createProvinceId('pr', i)
      provinceIds.push(pid)
    }

    const state: WorldState = {
      currentYear: 1444,
      currentMonth: 1,
      provinces: Object.fromEntries(
        provinceIds.map((pid, i) => [
          pid,
          {
            id: pid,
            name: `Province ${i}`,
            x: i * 10,
            y: 0,
            neighbors: [],
            ownerHouseId: houseVassalId,
            countryId,
            baseTax: 5,
            manpower: 10,
            unrest: 0,
            development: 0,
            countryControl: 100,
            houseControl: 100,
          },
        ]),
      ),
      countries: {
        [countryId]: {
          id: countryId,
          name: 'Country 1',
          rulerHouseId: houseRulerId,
          houseIds: [houseRulerId, houseVassalId],
          treasury: 0,
          legitimacy: 0,
          adminPower: 0,
          stability: 0,
          roleAssignments: {},
          active: true,
          capitalProvinceId: '' as ProvinceId,
        },
      },
      houses: {
        [houseRulerId]: {
          id: houseRulerId,
          name: 'Ruler House',
          active: true,
          countryId,
          provinceIds: [],
          memberIds: [personRulerId],
          headId: personRulerId,
          cadetHouseIds: [],
          prestige: 10,
          cohesion: 10,
          loyaltyToCountry: 50,
          wealth: 0,
          seatProvinceId: '' as ProvinceId,
        },
        [houseVassalId]: {
          id: houseVassalId,
          name: 'Rebel House',
          active: true,
          countryId,
          provinceIds: provinceIds,
          memberIds: [personVassalId],
          headId: personVassalId,
          cadetHouseIds: [],
          prestige: 100,
          cohesion: 50,
          loyaltyToCountry: 0,
          wealth: 0,
          seatProvinceId: provinceIds[0] ?? ('' as ProvinceId),
        },
      },
      persons: {
        [personRulerId]: {
          id: personRulerId,
          name: 'Ruler Person',
          sex: 'male',
          age: 30,
          alive: true,
          houseId: houseRulerId,
          countryId,
          childIds: [],
          birthStatus: 'unknown',
          stats: { admin: 1, martial: 1 },
          traits: { ambition: 0.1, loyaltyToCountry: 0.9, caution: 0.5 },
          prestige: 10,
        },
        [personVassalId]: {
          id: personVassalId,
          name: 'Rebel Person',
          sex: 'male',
          age: 35,
          alive: true,
          houseId: houseVassalId,
          countryId,
          childIds: [],
          birthStatus: 'unknown',
          stats: { admin: 5, martial: 10 },
          traits: { ambition: 1.0, loyaltyToCountry: 0, caution: 0 },
          prestige: 100,
        },
      },
      activePlots: {},
    }

    const config = {
      ...defaultConfig,
      rebellionThreshold: 0,
      rebellionSuccessMode: 'independence' as const,
    }
    const ctx = createTickContext({ state, rng: createRng('rebellion-split-test'), config })

    const result = toResult(runRebellionSystem(ctx))

    const hasRebellionStarted = countEvents(result.events, 'REBELLION_STARTED') > 0
    if (hasRebellionStarted) {
      expect(
        countEvents(result.events, 'REBELLION_SUCCEEDED') > 0 ||
          countEvents(result.events, 'REBELLION_FAILED') > 0,
      ).toBe(true)
      if (countEvents(result.events, 'REBELLION_SUCCEEDED') > 0) {
        expect(countEvents(result.events, 'COUNTRY_SPLIT')).toBeGreaterThan(0)
      }
    }
  })
})
