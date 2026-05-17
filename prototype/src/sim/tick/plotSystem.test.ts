import { describe, expect, it } from 'vitest'
import {
  createCountryId,
  createHouseId,
  createOfficeAssignmentId,
  createPersonId,
  createPlotId,
} from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import type { Plot } from '../types/plot'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runPlotSystem } from './plotSystem'
import type { SimEvent } from '../types/event'

function makeBaseState(): {
  state: WorldState
  countryId: CountryId
  houseId: HouseId
  personId: PersonId
} {
  const countryId = createCountryId('c', 0)
  const houseId = createHouseId('h', 0)
  const personId = createPersonId('pe', 0)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [countryId]: {
        id: countryId,
        name: 'Country 1',
        houseIds: [houseId],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [houseId]: {
        id: houseId,
        name: 'Test House',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [personId],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [personId]: {
        id: personId,
        name: 'Test Person',
        sex: 'male',
        age: 30,
        alive: true,
        houseId,
        countryId,
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

  const officeId = createOfficeAssignmentId(0)
  const stateWithLeader: WorldState = {
    ...state,
    officeAssignments: {
      [officeId]: {
        id: officeId,
        organization: { kind: 'house', id: houseId },
        role: 'leader',
        holderPersonId: personId,
        active: true,
        startYear: 1444,
        unpaidCount: 0,
      },
    },
    officeIndex: {
      byOrganization: { [`house:${houseId as string}`]: [officeId] },
      byHolderPerson: { [personId as string]: [officeId] },
    },
    nextOfficeAssignmentId: 1,
  }

  return { state: stateWithLeader, countryId, houseId, personId }
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runPlotSystem', () => {
  it('does not resolve plot when elapsedMonths < durationMonths', () => {
    const { state, countryId, personId } = makeBaseState()

    const plot: Plot = {
      id: createPlotId('p', 0),
      type: 'seize_office',
      status: 'active',
      startedYear: 1444,
      startedMonth: 1,
      durationMonths: 3,
      elapsedMonths: 0,
      leaderId: personId,
      participantIds: [personId],
      power: 50,
      secrecy: 50,
      risk: 20,
      targetCountryId: countryId,
      targetRole: 'administrator',
    }

    const stateWithPlot: WorldState = {
      ...state,
      activePlots: { [plot.id]: plot },
    }

    const config = { ...defaultConfig }
    const ctx = createTickContext({ state: stateWithPlot, rng: createRng('test'), config })

    const result = toResult(runPlotSystem(ctx))

    const resolvedPlot = result.state.activePlots[plot.id]!
    expect(resolvedPlot.status).toBe('active')
    expect(resolvedPlot.elapsedMonths).toBe(1)
    expect(countEvents(result.events, 'PLOT_SUCCEEDED')).toBe(0)
    expect(countEvents(result.events, 'PLOT_FAILED')).toBe(0)
  })

  it('resolves plot when elapsedMonths reaches durationMonths', () => {
    const { state, countryId, personId } = makeBaseState()

    const plot: Plot = {
      id: createPlotId('p', 0),
      type: 'seize_office',
      status: 'active',
      startedYear: 1444,
      startedMonth: 1,
      durationMonths: 3,
      elapsedMonths: 2,
      leaderId: personId,
      participantIds: [personId],
      power: 80,
      secrecy: 80,
      risk: 20,
      targetCountryId: countryId,
      targetRole: 'administrator',
    }

    const stateWithPlot: WorldState = {
      ...state,
      activePlots: { [plot.id]: plot },
    }

    const config = { ...defaultConfig }
    const ctx = createTickContext({ state: stateWithPlot, rng: createRng('resolve-test'), config })

    const result = toResult(runPlotSystem(ctx))

    const resolvedPlot = result.state.activePlots[plot.id]!
    expect(resolvedPlot.status).not.toBe('active')
    expect(resolvedPlot.status).toMatch(/^(succeeded|failed)$/)
    const plotEvents = result.events.filter(
      (e) => e.type === 'PLOT_SUCCEEDED' || e.type === 'PLOT_FAILED',
    )
    expect(plotEvents.length).toBe(1)
  })

  it('does not start new plot if plotTendency < plotThreshold', () => {
    const { state, countryId, houseId, personId } = makeBaseState()

    // Low plotTendency: ambition=0.1, loyaltyToCountry=0.9
    const stateWithLowTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personId]: {
          ...state.persons[personId]!,
          traits: { ambition: 0.1, loyaltyToCountry: 0.9, caution: 0.5 },
        },
      },
      houses: {
        ...state.houses,
        [houseId]: {
          ...state.houses[houseId]!,
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

    const config = { ...defaultConfig, plotThreshold: 65 }
    const ctx = createTickContext({ state: stateWithLowTendency, rng: createRng('test'), config })

    const result = toResult(runPlotSystem(ctx))

    expect(Object.keys(result.state.activePlots).length).toBe(0)
    expect(countEvents(result.events, 'PLOT_STARTED')).toBe(0)
  })

  it('starts new plot when plotTendency >= plotThreshold', () => {
    const { state, countryId, personId } = makeBaseState()

    // High plotTendency: ambition=0.9, caution=0.1, adminPower=20
    // Set strongly negative country attitude → houseLoyalty=0, headCountryLoyalty=0
    const countryKey = `country:${countryId as string}`
    const stateWithHighTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personId]: {
          ...state.persons[personId]!,
          traits: { ambition: 0.9, caution: 0.1 },
          attitudes: { [countryKey]: { affection: -100, respect: -100 } },
        },
      },
      countries: {
        ...state.countries,
        [countryId]: {
          ...state.countries[countryId]!,
          adminPower: 20,
        },
      },
    }

    const config = { ...defaultConfig, plotThreshold: 65 }
    const ctx = createTickContext({ state: stateWithHighTendency, rng: createRng('test'), config })

    const result = toResult(runPlotSystem(ctx))

    const activePlots = Object.values(result.state.activePlots).filter((p) => p.status === 'active')
    const plotStartedEvents = countEvents(result.events, 'PLOT_STARTED')
    expect(activePlots.length >= 1 || plotStartedEvents >= 1).toBe(true)
  })

  it('does not start second plot for house that already has active plot', () => {
    const { state, countryId, houseId, personId } = makeBaseState()

    const existingPlot: Plot = {
      id: createPlotId('p', 0),
      type: 'seize_office',
      status: 'active',
      startedYear: 1444,
      startedMonth: 1,
      durationMonths: 3,
      elapsedMonths: 0,
      leaderId: personId,
      participantIds: [personId],
      power: 50,
      secrecy: 50,
      risk: 20,
      targetCountryId: countryId,
      targetRole: 'administrator',
    }

    // High plotTendency to trigger start attempt
    const stateWithPlot: WorldState = {
      ...state,
      activePlots: { [existingPlot.id]: existingPlot },
      persons: {
        ...state.persons,
        [personId]: {
          ...state.persons[personId]!,
          traits: { ambition: 0.9, loyaltyToCountry: 0.1, caution: 0.1 },
        },
      },
      houses: {
        ...state.houses,
        [houseId]: {
          ...state.houses[houseId]!,
          prestige: 80,
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

    const config = { ...defaultConfig, plotThreshold: 65 }
    const ctx = createTickContext({ state: stateWithPlot, rng: createRng('test'), config })

    const result = toResult(runPlotSystem(ctx))

    const activePlotsForLeader = Object.values(result.state.activePlots).filter(
      (p) => p.leaderId === personId && p.status === 'active',
    )
    expect(activePlotsForLeader.length).toBe(1)
  })
})
