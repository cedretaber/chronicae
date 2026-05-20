import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { advanceTime } from './advanceTime'

function makeCtx(year: number, weekOfYear: number): TickContext {
  return {
    state: {
      currentYear: year,
      currentWeekOfYear: weekOfYear,
      absoluteWeek: year * 52 + (weekOfYear - 1),
      provinces: {},
      polities: {},
      houses: {},
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
      provinceOfficeAssignments: {},
      landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
      provinceTerminalPolityCache: {},
      provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
      polityIndex: { byOwnerHouse: {} },
      factions: {},
      factionMemberships: {},
      factionIndex: { byLeader: {}, byMember: {} },
      nextLandContractId: 0,
      nextProvinceOfficeAssignmentId: 0,
      nextFactionId: 0,
      nextFactionMembershipId: 0,
      actorIntents: {},
      diplomaticPlays: {},
      nextActorIntentId: 0,
      nextDiplomaticPlayId: 0,
    },
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

describe('advanceTime', () => {
  it('absoluteWeek increments by 1', () => {
    const ctx = makeCtx(1, 1)
    ctx.state.absoluteWeek = 52
    const result = advanceTime(ctx)
    expect(result.state.absoluteWeek).toBe(53)
    expect(result.state.currentWeekOfYear).toBe(2)
  })

  it('currentWeekOfYear increments', () => {
    const ctx = makeCtx(1, 1)
    const result = advanceTime(ctx)
    expect(result.state.currentWeekOfYear).toBe(2)
    expect(result.state.currentYear).toBe(1)
  })

  it('currentWeekOfYear wraps from 52 to 1 and currentYear increments', () => {
    const ctx = makeCtx(1000, 52)
    ctx.state.absoluteWeek = 52051
    const result = advanceTime(ctx)
    expect(result.state.currentWeekOfYear).toBe(1)
    expect(result.state.currentYear).toBe(1001)
    expect(result.state.absoluteWeek).toBe(52052)
  })

  it('does not mutate original ctx state', () => {
    const ctx = makeCtx(3, 6)
    const originalYear = ctx.state.currentYear
    const originalWeek = ctx.state.currentWeekOfYear

    advanceTime(ctx)

    expect(ctx.state.currentYear).toBe(originalYear)
    expect(ctx.state.currentWeekOfYear).toBe(originalWeek)
  })
})
