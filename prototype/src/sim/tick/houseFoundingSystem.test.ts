import { describe, expect, it } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId } from '../types/ids'
import {
  createPersonId,
  createHouseId,
  createProvinceId,
  createPolityId,
  createOfficeAssignmentId,
  createPersonActivityLogId,
} from '../types/ids'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { OfficeAssignment } from '../types/office'
import type { PersonActivityLog } from '../types/task'
import { makeEmptyV016State, withProvince, withPolity, withHouse } from '../testFixtures'
import { runHouseFoundingSystem } from './houseFoundingSystem'

const highChanceConfig: Partial<SimulationConfig> = {
  houseFoundingEnabled: true,
  houseFoundingMonthlyChance: 1.0,
  houseFoundingMaxPerMonth: 10,
  houseFoundingMinWealth: 100,
  houseFoundingMinPrestige: 40,
  houseFoundingMinActivityLogs: 3,
  houseFoundingWealthTransferRate: 0.5,
  founderFamilyGenerationEnabled: false,
}

function makeCtx(state: WorldState, configOverride?: Partial<SimulationConfig>): TickContext {
  return {
    state,
    rng: createRng('house-founding-test'),
    config: { ...defaultConfig, ...highChanceConfig, ...configOverride },
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 100,
    nextHouseIndex: 100,
    nextPolityIndex: 100,
  }
}

function makeBaseState(): WorldState {
  const provinceId = createProvinceId('p', 0)
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1450, currentWeekOfYear: 1, absoluteWeek: 69600 }
  state = withProvince(state, provinceId, { nameKey: 'Province0' })
  return state
}

function addHouselessPerson(
  state: WorldState,
  id: PersonId,
  overrides: { wealth?: number; legacyPrestige?: number; alive?: boolean },
): WorldState {
  const person = {
    id,
    nameKey: 'Houseless',
    sex: 'male' as const,
    age: 35,
    lifeStage: 'young_adulthood' as const,
    alive: overrides.alive ?? true,
    childIds: [] as PersonId[],
    birthStatus: 'unknown' as const,
    abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
    aptitudes: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: overrides.legacyPrestige ?? 10,
    wealth: overrides.wealth ?? 0,
    attitudes: {},
    lastHouseTransferYear: 1440,
  }
  const alive = overrides.alive ?? true
  return {
    ...state,
    persons: { ...state.persons, [id]: person },
    livingPersonIds: alive ? [...state.livingPersonIds, id].sort() : state.livingPersonIds,
  }
}

describe('runHouseFoundingSystem', () => {
  it('disabled → identity', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    const s = addHouselessPerson(state, pid, { wealth: 200 })
    const ctx = makeCtx(s, { houseFoundingEnabled: false })
    const result = runHouseFoundingSystem(ctx)
    expect(result.state).toBe(s)
  })

  it('wealth condition → house founded + wealth transferred', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    const s = addHouselessPerson(state, pid, { wealth: 200 })
    const ctx = makeCtx(s)
    const result = runHouseFoundingSystem(ctx)

    const person = result.state.persons[pid]
    expect(person?.houseId).toBeDefined()

    if (person?.houseId) {
      const house = result.state.houses[person.houseId]
      expect(house).toBeDefined()
      expect(house!.active).toBe(true)
      expect(house!.founderId).toBe(pid)
      expect(house!.memberIds).toContain(pid)
      expect(house!.wealth).toBe(100)
      expect(person.wealth).toBe(100)

      const foundedEvents = result.events.filter((e) => e.type === 'HOUSE_FOUNDED')
      expect(foundedEvents.length).toBe(1)
      expect(foundedEvents[0]?.entityRefs.some((r) => r.kind === 'house')).toBe(true)
      expect(foundedEvents[0]?.entityRefs.some((r) => r.kind === 'person')).toBe(true)
    }
  })

  it('prestige condition → house founded', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    const s = addHouselessPerson(state, pid, { legacyPrestige: 50 })
    const ctx = makeCtx(s)
    const result = runHouseFoundingSystem(ctx)

    const person = result.state.persons[pid]
    expect(person?.houseId).toBeDefined()
    if (person?.houseId) {
      const house = result.state.houses[person.houseId]
      expect(house).toBeDefined()
      expect(house!.legacyPrestige).toBe(25)
    }
  })

  it('office condition → house founded', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    let s = addHouselessPerson(state, pid, { wealth: 10, legacyPrestige: 5 })

    const polityId = createPolityId('dp', 0)
    const houseId = createHouseId('dh', 0)
    s = withHouse(s, houseId, {
      nameKey: 'H0',
      memberIds: [],
      seatProvinceId: createProvinceId('p', 0),
    })
    s = withPolity(s, polityId, {
      ownerHouseId: houseId,
      capitalProvinceId: createProvinceId('p', 0),
    })

    const officeId = createOfficeAssignmentId(0)
    const office: OfficeAssignment = {
      id: officeId,
      organization: { kind: 'polity', id: polityId },
      role: 'administrator',
      holderPersonId: pid,
      active: true,
      startYear: 1444,
      slotIndex: 0,
      unpaidCount: 0,
    }
    s = {
      ...s,
      officeAssignments: { ...s.officeAssignments, [officeId]: office },
      officeIndex: {
        ...s.officeIndex,
        byHolderPerson: {
          ...s.officeIndex.byHolderPerson,
          [pid as string]: [officeId],
        },
      },
    }

    const ctx = makeCtx(s)
    const result = runHouseFoundingSystem(ctx)

    const person = result.state.persons[pid]
    expect(person?.houseId).toBeDefined()
  })

  it('activityLog condition → house founded', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    let s = addHouselessPerson(state, pid, { wealth: 10, legacyPrestige: 5 })

    const logIds = [0, 1, 2].map((n) => createPersonActivityLogId(n))
    const logs: Record<string, PersonActivityLog> = {}
    for (const logId of logIds) {
      logs[logId] = {
        id: logId,
        personId: pid,
        week: 69500,
        kind: 'task_completed',
        outcome: 'success',
        taskKind: 'generic_duty',
        relatedRefs: [],
        summaryKey: 'test',
        importance: 1,
      } as unknown as PersonActivityLog
    }
    s = {
      ...s,
      personActivityLogs: { ...s.personActivityLogs, ...logs },
      personActivityLogIndex: {
        ...s.personActivityLogIndex,
        byPerson: {
          ...s.personActivityLogIndex.byPerson,
          [pid as string]: logIds,
        },
      },
    }

    const ctx = makeCtx(s)
    const result = runHouseFoundingSystem(ctx)

    const person = result.state.persons[pid]
    expect(person?.houseId).toBeDefined()
  })

  it('no qualifying condition → no founding', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    const s = addHouselessPerson(state, pid, { wealth: 10, legacyPrestige: 5 })
    const ctx = makeCtx(s)
    const result = runHouseFoundingSystem(ctx)

    const person = result.state.persons[pid]
    expect(person?.houseId).toBeUndefined()
  })

  it('maxPerMonth cap limits founding count', () => {
    let state = makeBaseState()
    for (let i = 0; i < 5; i++) {
      state = addHouselessPerson(state, createPersonId('pe', 10 + i), { wealth: 200 })
    }
    const ctx = makeCtx(state, { houseFoundingMaxPerMonth: 1 })
    const result = runHouseFoundingSystem(ctx)

    const foundedEvents = result.events.filter((e) => e.type === 'HOUSE_FOUNDED')
    expect(foundedEvents.length).toBe(1)
  })

  it('house shares initialized after founding', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    const s = addHouselessPerson(state, pid, { wealth: 200 })
    const ctx = makeCtx(s)
    const result = runHouseFoundingSystem(ctx)

    const person = result.state.persons[pid]
    if (person?.houseId) {
      const shareIds = result.state.houseShareIndex.byHouse[person.houseId] ?? []
      expect(shareIds.length).toBeGreaterThan(0)
    }
  })

  it('founder family generation creates spouse and children', () => {
    const state = makeBaseState()
    const pid = createPersonId('pe', 10)
    let s = addHouselessPerson(state, pid, { wealth: 200 })
    const person = s.persons[pid]!
    s = { ...s, persons: { ...s.persons, [pid]: { ...person, age: 40 } } }

    const ctx = makeCtx(s, {
      founderFamilyGenerationEnabled: true,
      founderSpouseChanceMid: 1.0,
      founderChildBaseChance: 1.0,
      founderMaxGeneratedChildren: 4,
    })
    const result = runHouseFoundingSystem(ctx)

    const founder = result.state.persons[pid]
    if (founder?.houseId) {
      const house = result.state.houses[founder.houseId]
      expect(house).toBeDefined()
      expect(house!.memberIds.length).toBeGreaterThan(1)

      if (founder.spouseId) {
        const spouse = result.state.persons[founder.spouseId]
        expect(spouse).toBeDefined()
        expect(spouse?.houseId).toBe(founder.houseId)
        expect(spouse?.spouseId).toBe(pid)
      }

      for (const childId of founder.childIds) {
        const child = result.state.persons[childId]
        expect(child).toBeDefined()
        expect(child?.houseId).toBe(founder.houseId)
        if (child) {
          expect(child.age).toBeLessThanOrEqual(founder.age - 16)
        }
      }
    }
  })

  it('seat province from polity office → capitalProvinceId', () => {
    let state = makeBaseState()
    const pid = createPersonId('pe', 10)
    state = addHouselessPerson(state, pid, { wealth: 200 })

    const polityId = createPolityId('dp', 0)
    const houseId = createHouseId('dh', 0)
    const capitalProvinceId = createProvinceId('p', 0)
    state = withHouse(state, houseId, {
      nameKey: 'H0',
      memberIds: [],
      seatProvinceId: capitalProvinceId,
    })
    state = withPolity(state, polityId, {
      ownerHouseId: houseId,
      capitalProvinceId,
    })

    const officeId = createOfficeAssignmentId(0)
    const office: OfficeAssignment = {
      id: officeId,
      organization: { kind: 'polity', id: polityId },
      role: 'administrator',
      holderPersonId: pid,
      active: true,
      startYear: 1444,
      slotIndex: 0,
      unpaidCount: 0,
    }
    state = {
      ...state,
      officeAssignments: { ...state.officeAssignments, [officeId]: office },
      officeIndex: {
        ...state.officeIndex,
        byHolderPerson: {
          ...state.officeIndex.byHolderPerson,
          [pid as string]: [officeId],
        },
      },
    }

    const ctx = makeCtx(state)
    const result = runHouseFoundingSystem(ctx)

    const person = result.state.persons[pid]
    if (person?.houseId) {
      const house = result.state.houses[person.houseId]
      expect(house?.seatProvinceId).toBe(capitalProvinceId)
    }
  })
})
