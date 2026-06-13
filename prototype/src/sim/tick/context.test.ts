import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { HouseId, PersonId, EventId } from '../types/ids'
import type { Person } from '../types/person'
import { createTickContext, makeEventId, makePersonId, toResult } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { buildLivingPersonIds } from '../testFixtures'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeMinimalWorld(personIds: PersonId[] = []): WorldState {
  const persons: Record<PersonId, Person> = {}
  for (const id of personIds) {
    persons[id] = {
      id,
      nameKey: 'Test',
      sex: 'male',
      age: 30,
      lifeStage: 'young_adulthood',
      alive: true,
      houseId: 'h-0' as HouseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 10,
      wealth: 0,
      attitudes: {},
    }
  }
  return {
    currentYear: 1,
    currentWeekOfYear: 1,
    absoluteWeek: 48,
    provinces: {},
    holdings: {},
    states: {},
    polities: {},
    houses: {},
    persons,
    livingPersonIds: buildLivingPersonIds(persons),
    activePlots: {},
    popGroups: {},
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    houseShares: {},
    politicalRights: {},
    politicalRightIndex: { byPolity: {}, byHolder: {}, byTarget: {} },
    nextPoliticalRightId: 0,
    personReputations: {},
    personReputationIndex: { byPerson: {}, byOrganization: {} },
    nextPersonReputationId: 0,
    officeAssignments: {},
    houseShareIndex: { byHouse: {}, byHolderPerson: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextHouseShareId: 0,
    nextOfficeAssignmentId: 0,
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {}, byPolity: {}, byParent: {} },
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
    waitingAimIds: [],
    nextTaskId: 0,
    nextPersonActivityLogId: 0,
    clans: {},
    nextClanId: 1,
  }
}

function makeConfig() {
  return defaultConfig
}

describe('createTickContext', () => {
  it('sets nextPersonIndex=0 when no persons exist', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(0)
  })

  it('sets nextPersonIndex to max index + 1 from existing persons (pe-0, pe-5, pe-12 -> 13)', () => {
    const personIds: PersonId[] = ['pe-0' as PersonId, 'pe-5' as PersonId, 'pe-12' as PersonId]
    const state = makeMinimalWorld(personIds)
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(13)
  })
})

describe('createTickContext nextEventIndex', () => {
  it('sets nextEventIndex=0', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextEventIndex).toBe(0)
  })
})

describe('makeEventId', () => {
  it('returns id in format e-{year}-{month}-{index} and increments nextEventIndex', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextEventIndex).toBe(0)

    const { id, ctx: updatedCtx } = makeEventId(ctx)
    expect(id).toBe('e-48-0')
    expect(updatedCtx.nextEventIndex).toBe(1)

    const { id: id2, ctx: updatedCtx2 } = makeEventId(updatedCtx)
    expect(id2).toBe('e-48-1')
    expect(updatedCtx2.nextEventIndex).toBe(2)
  })

  it('does not mutate ctx', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    const originalNextEventIndex = ctx.nextEventIndex

    makeEventId(ctx)

    expect(ctx.nextEventIndex).toBe(originalNextEventIndex)
  })
})

describe('makePersonId', () => {
  it('returns id in format pe-{index} and increments nextPersonIndex', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(0)

    const { id, ctx: updatedCtx } = makePersonId(ctx)
    expect(id).toBe('pe-0' as PersonId)
    expect(updatedCtx.nextPersonIndex).toBe(1)

    const { id: id2, ctx: updatedCtx2 } = makePersonId(updatedCtx)
    expect(id2).toBe('pe-1' as PersonId)
    expect(updatedCtx2.nextPersonIndex).toBe(2)
  })
})

describe('toResult', () => {
  it('returns state, rng, and events as array', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })

    const result = toResult(ctx)

    // 調査 §4.5: toResult は永続化した next index を書き戻すため state は新オブジェクトになる。
    // 内容は元 state と等価 + counter フィールドが付与されていることを確認する。
    expect(result.state).toEqual({
      ...state,
      nextPersonIndex: ctx.nextPersonIndex,
      nextHouseIndex: ctx.nextHouseIndex,
      nextPolityIndex: ctx.nextPolityIndex,
    })
    expect(result.rng).toBe(rng)
    expect(Array.isArray(result.events)).toBe(true)
    expect(result.events).toHaveLength(0)
  })

  it('events array is a copy, not the same reference', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })

    const result = toResult(ctx)
    result.events.push({
      id: 'e-48-99' as EventId,
      year: 1,
      weekOfYear: 1,
      type: 'PERSON_DIED',
      importance: 'minor',
      messageKey: 'test.person_died',
      messageParams: {},
      entityRefs: [],
      reasons: [],
      effects: [],
    })

    const result2 = toResult(ctx)
    expect(result2.events).toHaveLength(0)
  })
})
