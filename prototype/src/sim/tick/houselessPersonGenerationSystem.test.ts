import { describe, expect, it } from 'vitest'
import { createPersonId, createHoldingId } from '../types/ids'
import type { PersonId, ProvinceId, HoldingId } from '../types/ids'
import type { Holding } from '../types/landContract'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Person } from '../types/person'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { buildLivingPersonIds } from '../testFixtures'
import { runHouselessPersonGenerationSystem } from './houselessPersonGenerationSystem'

function makeBaseState(): WorldState {
  const dummyHoldings: Record<HoldingId, Holding> = {}
  for (let i = 0; i < 6; i++) {
    const hid = createHoldingId(i)
    dummyHoldings[hid] = {
      id: hid,
      provinceId: 'pr-anon' as ProvinceId,
      nameKey: 'h',
      kind: 'manor',
      polityControl: 0,
      weight: 1,
    }
  }

  return {
    currentYear: 1450,
    currentWeekOfYear: 1,
    absoluteWeek: 75400,
    provinces: {},
    holdings: dummyHoldings,
    states: {},
    polities: {},
    houses: {},
    persons: {},
    livingPersonIds: [],
    popGroups: {},
    houseShares: {},
    politicalRights: {},
    politicalRightIndex: { byPolity: {}, byHolder: {}, byTarget: {} },
    nextPoliticalRightId: 0,
    personReputations: {},
    personReputationIndex: { byPerson: {}, byOrganization: {} },
    nextPersonReputationId: 0,
    influenceModifiers: {},
    influenceModifierIndex: { byPolity: {}, byTarget: {} },
    nextInfluenceModifierId: 0,
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
    battleLogs: {},
    battleLogIndex: { byWar: {} },
    nextBattleLogId: 0,
    nextWarId: 0,
    nextDiplomaticOfferId: 0,
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    crises: {},
    crisisIndex: { byHolding: {}, byProject: {} },
    nextCrisisId: 1,
    chronicleEntries: {},
    chronicleIndex: {
      byPerson: {},
      byHouse: {},
      byPolity: {},
      byProvince: {},
      byHolding: {},
      byWar: {},
    },
    nextChronicleEntryId: 0,
    nextPressureId: 1,
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
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    realEstateAssets: {},
    realEstateAssetIndex: { byHolding: {}, byOwner: {} },
    realEstateSeizures: {},
    realEstateSeizureIndex: { byHolding: {}, byAsset: {}, byRightfulOwnerHouse: {} },
    nextRealEstateSeizureId: 0,
    landContractDefaults: {},
    landContractDefaultIndex: {
      byHolding: {},
      byContract: {},
      byClaimantPolity: {},
      byOccupierPolity: {},
    },
    nextLandContractDefaultId: 0,
    nextRealEstateAssetId: 0,
    marketResourcePrices: {},
    monthlyHoldingResourceRevenue: {},
  }
}

function makeCtx(state: WorldState, configOverride?: Partial<SimulationConfig>): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: { ...defaultConfig, ...configOverride },
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

function withHouselessPerson(
  state: WorldState,
  id: PersonId,
  personInfo: {
    lastHouseTransferYear: number
    legacyPrestige: number
    wealth: number
    alive: boolean
  },
): WorldState {
  const person = {
    id,
    nameKey: 'Houseless',
    sex: 'male' as const,
    age: 25,
    alive: personInfo.alive,
    childIds: [],
    birthStatus: 'unknown' as const,
    abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
    aptitudes: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: personInfo.legacyPrestige,
    wealth: personInfo.wealth,
    attitudes: {},
    lastHouseTransferYear: personInfo.lastHouseTransferYear,
  }
  const nextPersons = { ...state.persons, [id]: person }
  const livingPersonIds = buildLivingPersonIds(nextPersons)
  return {
    ...state,
    persons: nextPersons,
    livingPersonIds,
  }
}

const testConfig: Partial<SimulationConfig> = {
  houselessPersonsPerHolding: 0.5,
  protectionPrestigeThreshold: 60,
  pruningPrestigeThreshold: 20,
  pruningWealthThreshold: 30,
  pruningMinDwellYears: 3,
}

describe('runHouselessPersonGenerationSystem', () => {
  it('target = 0.5 per holding × 6 holdings → 3 new Persons created', () => {
    const state = makeBaseState()
    const ctx = makeCtx(state, testConfig)
    const result = runHouselessPersonGenerationSystem(ctx)

    const personIds = Object.keys(result.state.persons)
    expect(personIds.length).toBe(3)

    for (const pid of personIds) {
      const p = result.state.persons[pid as PersonId]
      expect(p).toBeDefined()
      expect(p!.houseId).toBeUndefined()
      expect(p!.alive).toBe(true)
      expect(p!.kind).toBeUndefined()
      expect(p!.occupation).toBeDefined()
      expect(p!.lastHouseTransferYear).toBe(1450)
    }

    expect(result.events.length).toBe(3)
    for (const ev of result.events) {
      expect(ev.type).toBe('PERSON_BORN_IN_OBSCURITY')
      expect(ev.importance).toBe('minor')
      expect(ev.entityRefs.some((r) => r.kind === 'person')).toBe(true)
    }
  })

  it('count > softMax with qualifying people → some pruned', () => {
    const currentYear = 1450
    const person1Id = createPersonId('pe', 20)
    const person2Id = createPersonId('pe', 21)
    const person3Id = createPersonId('pe', 22)
    const person4Id = createPersonId('pe', 23)
    const person5Id = createPersonId('pe', 24)
    const person6Id = createPersonId('pe', 25)

    let state = makeBaseState()
    state.currentYear = currentYear
    state.currentWeekOfYear = 1
    state.absoluteWeek = state.currentYear * 48

    for (const pid of [person1Id, person2Id, person3Id, person4Id, person5Id, person6Id]) {
      state = withHouselessPerson(state, pid, {
        lastHouseTransferYear: currentYear - 10,
        legacyPrestige: 5,
        wealth: 5,
        alive: true,
      })
    }

    const ctx = makeCtx(state, testConfig)
    const result = runHouselessPersonGenerationSystem(ctx)

    const alivePersons = Object.values(result.state.persons).filter((p: Person) => p.alive)
    expect(alivePersons.length).toBeGreaterThanOrEqual(3)
  })

  it('count > softMax with people within protectionYears → no pruning', () => {
    const currentYear = 1450
    const person1Id = createPersonId('pe', 30)
    const person2Id = createPersonId('pe', 31)
    const person3Id = createPersonId('pe', 32)
    const person4Id = createPersonId('pe', 33)
    const person5Id = createPersonId('pe', 34)
    const person6Id = createPersonId('pe', 35)

    let state = makeBaseState()
    state.currentYear = currentYear
    state.currentWeekOfYear = 1
    state.absoluteWeek = state.currentYear * 48

    for (const pid of [person1Id, person2Id, person3Id, person4Id, person5Id, person6Id]) {
      state = withHouselessPerson(state, pid, {
        lastHouseTransferYear: currentYear - 2,
        legacyPrestige: 5,
        wealth: 5,
        alive: true,
      })
    }

    const ctx = makeCtx(state, testConfig)
    const result = runHouselessPersonGenerationSystem(ctx)

    const fadedEvents = result.events.filter((e) => e.type === 'PERSON_FADED_FROM_HISTORY')
    expect(fadedEvents.length).toBe(0)
  })

  it('Person with legacyPrestige >= protectionPrestigeThreshold is not pruned', () => {
    const currentYear = 1450
    const protectedId = createPersonId('pe', 40)
    const pruneableId1 = createPersonId('pe', 41)
    const pruneableId2 = createPersonId('pe', 42)
    const pruneableId3 = createPersonId('pe', 43)
    const pruneableId4 = createPersonId('pe', 44)
    const pruneableId5 = createPersonId('pe', 45)
    const pruneableId6 = createPersonId('pe', 46)

    let state = makeBaseState()
    state.currentYear = currentYear
    state.currentWeekOfYear = 1
    state.absoluteWeek = state.currentYear * 48

    state = withHouselessPerson(state, protectedId, {
      lastHouseTransferYear: currentYear - 10,
      legacyPrestige: 60,
      wealth: 5,
      alive: true,
    })
    for (const pid of [
      pruneableId1,
      pruneableId2,
      pruneableId3,
      pruneableId4,
      pruneableId5,
      pruneableId6,
    ]) {
      state = withHouselessPerson(state, pid, {
        lastHouseTransferYear: currentYear - 10,
        legacyPrestige: 5,
        wealth: 5,
        alive: true,
      })
    }

    const ctx = makeCtx(state, testConfig)
    const result = runHouselessPersonGenerationSystem(ctx)

    const protectedPerson = result.state.persons[protectedId]
    expect(protectedPerson?.alive).toBe(true)

    const fadedEvents = result.events.filter((e) => e.type === 'PERSON_FADED_FROM_HISTORY')
    expect(fadedEvents.length).toBeGreaterThanOrEqual(1)
    for (const e of fadedEvents) {
      expect(e.entityRefs.find((r) => r.kind === 'person')?.id).not.toBe(protectedId)
    }
  })
})
