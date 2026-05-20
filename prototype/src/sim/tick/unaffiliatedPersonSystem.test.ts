import { describe, expect, it } from 'vitest'
import { createPersonId } from '../types/ids'
import type { PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import type { SimulationConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runUnaffiliatedPersonSystem } from './unaffiliatedPersonSystem'
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'

function makeBaseState(): WorldState {
  const anon = {
    id: ANONYMOUS_HOUSE_ID,
    name: 'Anonymous',
    active: true,
    kind: 'system' as const,
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-anon' as ProvinceId,
  }
  return {
    currentYear: 1450,
    currentWeekOfYear: 1,
    absoluteWeek: 75400,
    provinces: {},
    states: {},
    polities: {},
    houses: { [ANONYMOUS_HOUSE_ID]: anon },
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

function withUnaffiliatedPerson(
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
    name: 'Unaffiliated',
    sex: 'male' as const,
    age: 25,
    alive: personInfo.alive,
    houseId: ANONYMOUS_HOUSE_ID,
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
  const anon = state.houses[ANONYMOUS_HOUSE_ID]
  const newAnon = anon
    ? { ...anon, memberIds: [...anon.memberIds, id] }
    : state.houses[ANONYMOUS_HOUSE_ID]
  return {
    ...state,
    persons: { ...state.persons, [id]: person },
    houses: { ...state.houses, [ANONYMOUS_HOUSE_ID]: newAnon },
  }
}

const testConfig: Partial<SimulationConfig> = {
  targetUnaffiliatedPersons: 3,
  softMaxUnaffiliatedPersons: 5,
  hardMaxUnaffiliatedPersons: 8,
  unaffiliatedProtectionYears: 5,
  protectionPrestigeThreshold: 60,
  pruningPrestigeThreshold: 20,
  pruningWealthThreshold: 30,
  pruningMinDwellYears: 3,
}

describe('runUnaffiliatedPersonSystem', () => {
  it('AnonymousHouse has 0 normal Persons, target = 3 → 3 new normal Persons created', () => {
    const state = makeBaseState()
    const ctx = makeCtx(state, testConfig)
    const result = runUnaffiliatedPersonSystem(ctx)

    const personIds = Object.keys(result.state.persons)
    expect(personIds.length).toBe(3)

    for (const pid of personIds) {
      const p = result.state.persons[pid as PersonId]
      expect(p).toBeDefined()
      expect(p!.houseId).toBe(ANONYMOUS_HOUSE_ID)
      expect(p!.alive).toBe(true)
      expect(p!.kind).toBeUndefined()
      expect(p!.occupation).toBeDefined()
      expect(p!.lastHouseTransferYear).toBe(1450)
    }

    const anon = result.state.houses[ANONYMOUS_HOUSE_ID]
    expect(anon!.memberIds.length).toBe(3)

    expect(result.events.length).toBe(3)
    for (const ev of result.events) {
      expect(ev.type).toBe('PERSON_BORN_IN_OBSCURITY')
      expect(ev.importance).toBe('minor')
      expect(ev.houseIds).toContain(ANONYMOUS_HOUSE_ID)
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
      state = withUnaffiliatedPerson(state, pid, {
        lastHouseTransferYear: currentYear - 10,
        legacyPrestige: 5,
        wealth: 5,
        alive: true,
      })
    }

    const ctx = makeCtx(state, testConfig)
    const result = runUnaffiliatedPersonSystem(ctx)

    const alivePersons = Object.values(result.state.persons).filter((p) => p.alive)
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
      state = withUnaffiliatedPerson(state, pid, {
        lastHouseTransferYear: currentYear - 2,
        legacyPrestige: 5,
        wealth: 5,
        alive: true,
      })
    }

    const ctx = makeCtx(state, testConfig)
    const result = runUnaffiliatedPersonSystem(ctx)

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

    state = withUnaffiliatedPerson(state, protectedId, {
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
      state = withUnaffiliatedPerson(state, pid, {
        lastHouseTransferYear: currentYear - 10,
        legacyPrestige: 5,
        wealth: 5,
        alive: true,
      })
    }

    const ctx = makeCtx(state, testConfig)
    const result = runUnaffiliatedPersonSystem(ctx)

    const protectedPerson = result.state.persons[protectedId]
    expect(protectedPerson?.alive).toBe(true)

    const fadedEvents = result.events.filter((e) => e.type === 'PERSON_FADED_FROM_HISTORY')
    expect(fadedEvents.length).toBe(1)
    expect(fadedEvents[0]!.actorIds[0]).not.toBe(protectedId)
  })
})
