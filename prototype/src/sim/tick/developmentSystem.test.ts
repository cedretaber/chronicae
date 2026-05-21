import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { ProvinceId, HouseId, PolityId, HoldingId } from '../types/ids'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runDevelopmentSystem } from './developmentSystem'

function makeProvinceState(development: number): WorldState {
  const provinceId = 'p-0' as ProvinceId
  const holdingId = 'hl-0' as HoldingId
  const houseId = 'h-0' as HouseId
  const polityId = 'dp-0' as PolityId

  return {
    currentYear: 1,
    currentWeekOfYear: 1,
    absoluteWeek: 48,
    provinces: {
      [provinceId]: {
        id: provinceId,
        stateId: 'sr-0' as import('../types/ids').StateRegionId,
        name: 'P0',
        x: 0,
        y: 0,
        neighbors: [],
        habitability: 50,
        popGroupIds: [],
        holdingIds: [holdingId],
      },
    },
    holdings: {
      [holdingId]: {
        id: holdingId,
        provinceId,
        kind: 'manor' as const,
        name: 'P0',
        development,
        polityControl: 100,
        landQuality: 50,
        weight: 1,
      },
    },
    states: {},
    polities: {
      [polityId]: {
        id: polityId,
        name: 'C0',
        rank: 2,
        ownerHouseId: houseId,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 50,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [houseId]: {
        id: houseId,
        name: 'H0',
        active: true,
        memberIds: [],
        deceasedMemberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 100,
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
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    actorIntents: {},
    diplomaticPlays: {},
    nextActorIntentId: 0,
    nextDiplomaticPlayId: 0,
  }
}

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

describe('runDevelopmentSystem', () => {
  it('positive development decays toward 0 by developmentPositiveMonthlyDecay per month', () => {
    const world = makeProvinceState(10)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    const holdingId = result.state.provinces['p-0' as ProvinceId]!.holdingIds[0]!
    expect(result.state.holdings[holdingId]!.development).toBe(9.9)
  })

  it('negative development recovers toward 0 by developmentNegativeMonthlyRecovery per month', () => {
    const world = makeProvinceState(-10)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    const holdingId = result.state.provinces['p-0' as ProvinceId]!.holdingIds[0]!
    expect(result.state.holdings[holdingId]!.development).toBe(-9.75)
  })

  it('development = 0 stays at 0', () => {
    const world = makeProvinceState(0)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    const holdingId = result.state.provinces['p-0' as ProvinceId]!.holdingIds[0]!
    expect(result.state.holdings[holdingId]!.development).toBe(0)
  })

  it('positive development does NOT go below 0', () => {
    const world = makeProvinceState(0.05)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    const holdingId = result.state.provinces['p-0' as ProvinceId]!.holdingIds[0]!
    expect(result.state.holdings[holdingId]!.development).toBe(0)
  })

  it('negative development does NOT go above 0', () => {
    const world = makeProvinceState(-0.1)
    const ctx = makeCtx(world)

    const result = runDevelopmentSystem(ctx)

    const holdingId = result.state.provinces['p-0' as ProvinceId]!.holdingIds[0]!
    expect(result.state.holdings[holdingId]!.development).toBe(0)
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
