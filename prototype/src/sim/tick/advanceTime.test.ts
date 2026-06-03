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
      absoluteWeek: year * 48 + (weekOfYear - 1),
      provinces: {},
      holdings: {},
      states: {},
      polities: {},
      houses: {},
      persons: {},
      livingPersonIds: [],
      activePlots: {},
      popGroups: {},
      popIndex: { byHolding: {} },
      nextPopGroupId: 0,
      organizationShares: {},
      officeAssignments: {},
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 0,
      landContracts: {},
      holdingOfficeAssignments: {},
      holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
      landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
      holdingTerminalPolityCache: {},
      polityIndex: { byOwnerHouse: {} },
      factions: {},
      factionMemberships: {},
      factionIndex: { byLeader: {}, byMember: {} },
      holdingImprovements: {},
      holdingImprovementIndex: { byHolding: {} },
      nextHoldingImprovementId: 0,
      nextLandContractId: 0,
      nextHoldingOfficeAssignmentId: 0,
      nextFactionId: 0,
      nextFactionMembershipId: 0,
      diplomaticPlays: {},
      diplomaticOffers: {},
      projects: {},
      projectIndex: {
        byOwner: {},
        byAim: {},
        byParentProject: {},
        byCreatorPerson: {},
        bySupervisorPerson: {},
        byRelatedEntity: {},
      },
      nextProjectId: 0,
      nextDiplomaticPlayId: 0,
      wars: {},
      warIndex: { byParticipant: {}, byOriginDiplomaticPlay: {} },
      regiments: {},
      regimentIndex: { byOwner: {}, byWar: {}, byHomeProvince: {}, byHomeHolding: {} },
      nextRegimentId: 0,
      battles: {},
      battleIndex: { byWar: {} },
      nextBattleId: 0,
      nextWarId: 0,
      nextDiplomaticOfferId: 0,
      pressures: {},
      pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
      chronicleEntries: {},
      chronicleIndex: { byPerson: {}, byHouse: {}, byPolity: {}, byProvince: {}, byHolding: {} },
      nextChronicleEntryId: 0,
      nextPressureId: 1,
      // v0.22 Goal/Aim system
      goals: {},
      aims: {},
      decisionReasons: {},
      goalIndex: { byOwner: {} },
      aimIndex: { byOwner: {}, byGoal: {} },
      nextGoalId: 0,
      nextAimId: 0,
      nextDecisionReasonId: 0,
      tasks: {},
      taskIndex: { byAssignee: {}, byOwner: {}, byTarget: {} },
      personActivityLogs: {},
      personActivityLogIndex: { byPerson: {} },
      personTrainingExperience: {},
      waitingAimIds: [],
      nextTaskId: 0,
      nextPersonActivityLogId: 0,
      clans: {},
      nextClanId: 1,
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
    ctx.state.absoluteWeek = 48
    const result = advanceTime(ctx)
    expect(result.state.absoluteWeek).toBe(49)
    expect(result.state.currentWeekOfYear).toBe(2)
  })

  it('currentWeekOfYear increments', () => {
    const ctx = makeCtx(1, 1)
    const result = advanceTime(ctx)
    expect(result.state.currentWeekOfYear).toBe(2)
    expect(result.state.currentYear).toBe(1)
  })

  it('currentWeekOfYear wraps from 48 to 1 and currentYear increments', () => {
    const ctx = makeCtx(1000, 48)
    ctx.state.absoluteWeek = 48047
    const result = advanceTime(ctx)
    expect(result.state.currentWeekOfYear).toBe(1)
    expect(result.state.currentYear).toBe(1001)
    expect(result.state.absoluteWeek).toBe(48048)
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
