import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createOfficeAssignmentId,
  createPersonId,
  createPlotId,
  createProvinceId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import type { Plot } from '../types/plot'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runPlotSystem } from './plotSystem'
import type { SimEvent } from '../types/event'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'

function makeBaseState(): {
  state: WorldState
  polityId: PolityId
  houseId: HouseId
  personId: PersonId
} {
  const polityId = createPolityId('c', 0)
  const houseId = createHouseId('h', 0)
  const personId = createPersonId('pe', 0)
  const provinceId = createProvinceId('p', 0)

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312 }
  state = withProvince(state, provinceId, { name: 'Capital' })
  state = withHouse(state, houseId, {
    name: 'Test House',
    memberIds: [personId],
    legacyPrestige: 50,
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, {
    name: 'Polity 1',
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  state = withPerson(state, personId, {
    name: 'Test Person',
    houseId,
    birthStatus: 'unknown',
    legacyPrestige: 50,
  })

  const officeId = createOfficeAssignmentId(0)
  const stateWithLeader: WorldState = {
    ...state,
    officeAssignments: {
      ...state.officeAssignments,
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
      byOrganization: {
        ...state.officeIndex.byOrganization,
        [`house:${houseId as string}`]: [officeId],
      },
      byHolderPerson: {
        ...state.officeIndex.byHolderPerson,
        [personId as string]: [officeId],
      },
    },
    nextOfficeAssignmentId: state.nextOfficeAssignmentId + 1,
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    actorIntents: {},
    diplomaticPlays: {},
    nextActorIntentId: 0,
    nextDiplomaticPlayId: 0,
  }

  return { state: stateWithLeader, polityId, houseId, personId }
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runPlotSystem', () => {
  it('does not resolve plot when elapsedMonths < durationMonths', () => {
    const { state, polityId, personId } = makeBaseState()

    const plot: Plot = {
      id: createPlotId('p', 0),
      type: 'seize_office',
      status: 'active',
      startedWeek: 69312,
      durationWeeks: 12,
      leaderId: personId,
      participantIds: [personId],
      power: 50,
      secrecy: 50,
      risk: 20,
      targetPolityId: polityId,
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
    expect(countEvents(result.events, 'PLOT_SUCCEEDED')).toBe(0)
    expect(countEvents(result.events, 'PLOT_FAILED')).toBe(0)
  })

  it('resolves plot when elapsedMonths reaches durationMonths', () => {
    const { state, polityId, personId } = makeBaseState()

    const plot: Plot = {
      id: createPlotId('p', 0),
      type: 'seize_office',
      status: 'active',
      startedWeek: 69312,
      durationWeeks: 12,
      leaderId: personId,
      participantIds: [personId],
      power: 80,
      secrecy: 80,
      risk: 20,
      targetPolityId: polityId,
      targetRole: 'administrator',
    }

    const stateWithPlot: WorldState = {
      ...state,
      absoluteWeek: 75100,
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
    const { state, polityId, houseId, personId } = makeBaseState()

    // Low plotTendency: ambition=0.1, loyaltyToPolity=0.9
    const stateWithLowTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personId]: {
          ...state.persons[personId]!,
          traits: { ambition: 0.1, loyaltyToPolity: 0.9, caution: 0.5 },
        },
      },
      houses: {
        ...state.houses,
        [houseId]: {
          ...state.houses[houseId]!,
          loyaltyToPolity: 90,
        },
      },
      polities: {
        ...state.polities,
        [polityId]: {
          ...state.polities[polityId]!,
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
    const { state, polityId, personId } = makeBaseState()

    // High plotTendency: ambition=0.9, caution=0.1, adminPower=20
    // Set strongly negative polity attitude → houseLoyalty=0, headPolityLoyalty=0
    const polityKey = `polity:${polityId as string}`
    const stateWithHighTendency: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [personId]: {
          ...state.persons[personId]!,
          traits: { ambition: 0.9, caution: 0.1 },
          attitudes: { [polityKey]: { affection: -100, respect: -100 } },
        },
      },
      polities: {
        ...state.polities,
        [polityId]: {
          ...state.polities[polityId]!,
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
    const { state, polityId, houseId, personId } = makeBaseState()

    const existingPlot: Plot = {
      id: createPlotId('p', 0),
      type: 'seize_office',
      status: 'active',
      startedWeek: 69312,
      durationWeeks: 12,
      leaderId: personId,
      participantIds: [personId],
      power: 50,
      secrecy: 50,
      risk: 20,
      targetPolityId: polityId,
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
          traits: { ambition: 0.9, loyaltyToPolity: 0.1, caution: 0.1 },
        },
      },
      houses: {
        ...state.houses,
        [houseId]: {
          ...state.houses[houseId]!,
          prestige: 80,
          loyaltyToPolity: 20,
        },
      },
      polities: {
        ...state.polities,
        [polityId]: {
          ...state.polities[polityId]!,
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
