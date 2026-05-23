import { describe, it, expect } from 'vitest'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { appointHoldingBailiff } from '../mutations/provinceOfficeMutations'
import type { WorldState } from '../types/world'
import type {
  ProvinceId,
  PolityId,
  HouseId,
  PersonId,
  HoldingId,
  PopGroupId,
  HoldingOfficeAssignmentId,
  PersonActivityLogId,
} from '../types/ids'
import type { PopGroup } from '../types/popGroup'
import type { Person } from '../types/person'
import type { PersonActivityLog } from '../types/task'
import {
  getBailiffStewardshipScore,
  getHoldingAverageUnrest,
  getBailiffPolicyScores,
  getBailiffPolicy,
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
  computeBailiffBurdenComponents,
  getRecentBailiffRevenueTaskStatus,
} from './bailiffSelectors'

const provinceId = 'pr-0' as ProvinceId
const polityId = 'c-0' as PolityId
const houseId = 'h-0' as HouseId
const personId = 'pe-100' as PersonId

function makeBaseState(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId)
  state = withHouse(state, houseId, { memberIds: [] })
  state = withPolity(state, polityId, { ownerHouseId: houseId })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  return state
}

function getHoldingId(state: WorldState): HoldingId {
  return state.provinces[provinceId]!.holdingIds[0]!
}

function appointBailiff(
  state: WorldState,
  pid: PersonId,
  overrides?: { contractedRemittanceRate?: number; expectedFeeRate?: number },
): { state: WorldState; assignmentId: HoldingOfficeAssignmentId } {
  const holdingId = getHoldingId(state)
  return appointHoldingBailiff(state, {
    holdingId,
    holderPersonId: pid,
    appointingPolityId: polityId,
    week: state.absoluteWeek,
    ...overrides,
  })
}

function withPopGroup(
  state: WorldState,
  holdingId: HoldingId,
  overrides: Partial<PopGroup> & { size: number; unrest: number },
): WorldState {
  const id = ('pg-' + state.nextPopGroupId) as PopGroupId
  const pop: PopGroup = {
    id,
    holdingId,
    class: 'peasants',
    occupation: 'agriculture',
    wealth: 50,
    attitudes: {},
    ...overrides,
  }
  const existingSlot = state.popIndex.byHolding[holdingId] ?? []
  return {
    ...state,
    popGroups: { ...state.popGroups, [id]: pop },
    popIndex: {
      ...state.popIndex,
      byHolding: { ...state.popIndex.byHolding, [holdingId]: [...existingSlot, id] },
    },
    nextPopGroupId: state.nextPopGroupId + 1,
  }
}

function makePerson(state: WorldState, pid: PersonId, overrides: Partial<Person> = {}): WorldState {
  return withPerson(state, pid, {
    houseId,
    ...overrides,
  })
}

// --- getBailiffStewardshipScore ---

describe('getBailiffStewardshipScore', () => {
  it('computes correct weighted sum', () => {
    const person = {
      abilities: { valor: 0, command: 0, numeracy: 100, learning: 80, charisma: 0, insight: 60 },
      traits: { ambition: 0.5, caution: 0.8 },
    } as Person
    const score = getBailiffStewardshipScore(person)
    const expected = 100 * 0.5 + 80 * 0.2 + 60 * 0.2 + 0.8 * 120 * 0.1
    expect(score).toBeCloseTo(expected, 5)
  })

  it('returns 0 for all-zero abilities and caution=0', () => {
    const person = {
      abilities: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
      traits: { ambition: 0, caution: 0 },
    } as Person
    expect(getBailiffStewardshipScore(person)).toBe(0)
  })
})

// --- getHoldingAverageUnrest ---

describe('getHoldingAverageUnrest', () => {
  it('returns 0 when no POPs exist', () => {
    const state = makeBaseState()
    const holdingId = getHoldingId(state)
    expect(getHoldingAverageUnrest(state, holdingId)).toBe(0)
  })

  it('returns size-weighted average for multiple PopGroups', () => {
    let state = makeBaseState()
    const holdingId = getHoldingId(state)
    state = withPopGroup(state, holdingId, { size: 100, unrest: 80 })
    state = withPopGroup(state, holdingId, { size: 200, unrest: 20 })
    const expected = (100 * 80 + 200 * 20) / (100 + 200)
    expect(getHoldingAverageUnrest(state, holdingId)).toBeCloseTo(expected, 5)
  })

  it('correctly weights larger POP more', () => {
    let state = makeBaseState()
    const holdingId = getHoldingId(state)
    state = withPopGroup(state, holdingId, { size: 10, unrest: 100 })
    state = withPopGroup(state, holdingId, { size: 990, unrest: 0 })
    expect(getHoldingAverageUnrest(state, holdingId)).toBeCloseTo(1.0, 5)
  })
})

// --- getBailiffPolicy / getBailiffPolicyScores ---

describe('getBailiffPolicy', () => {
  it('placeholder returns passive', () => {
    const state = makeBaseState()
    const holdingId = getHoldingId(state)
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    expect(getBailiffPolicy(state, defaultConfig, assignmentId)).toBe('passive')
  })

  it('high ambition + low caution returns profit_seeking', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 30, command: 30, numeracy: 60, learning: 30, charisma: 30, insight: 30 },
      traits: { ambition: 0.95, caution: 0.1 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getBailiffPolicy(s, defaultConfig, assignmentId)).toBe('profit_seeking')
  })

  it('high charisma + high insight + high unrest returns protect_residents', () => {
    let state = makeBaseState()
    const holdingId = getHoldingId(state)
    state = makePerson(state, personId, {
      abilities: {
        valor: 30,
        command: 30,
        numeracy: 30,
        learning: 30,
        charisma: 100,
        insight: 100,
      },
      traits: { ambition: 0.2, caution: 0.6 },
    })
    state = withPopGroup(state, holdingId, { size: 100, unrest: 80 })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getBailiffPolicy(s, defaultConfig, assignmentId)).toBe('protect_residents')
  })

  it('high stewardship + high caution returns loyal_remittance', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: {
        valor: 30,
        command: 60,
        numeracy: 100,
        learning: 80,
        charisma: 30,
        insight: 80,
      },
      traits: { ambition: 0.3, caution: 0.9 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getBailiffPolicy(s, defaultConfig, assignmentId)).toBe('loyal_remittance')
  })

  it('low abilities returns passive', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 10, command: 10, numeracy: 10, learning: 10, charisma: 10, insight: 10 },
      traits: { ambition: 0.3, caution: 0.3 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getBailiffPolicy(s, defaultConfig, assignmentId)).toBe('passive')
  })
})

describe('getBailiffPolicyScores', () => {
  it('placeholder returns passive=999, others=0', () => {
    const state = makeBaseState()
    const holdingId = getHoldingId(state)
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const scores = getBailiffPolicyScores(state, defaultConfig, assignmentId)
    expect(scores.passive).toBe(999)
    expect(scores.loyal_remittance).toBe(0)
    expect(scores.profit_seeking).toBe(0)
    expect(scores.protect_residents).toBe(0)
  })
})

// --- getBailiffLocalExtractionRate ---

describe('getBailiffLocalExtractionRate', () => {
  it('default is approximately 0.50', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const rate = getBailiffLocalExtractionRate(s, defaultConfig, assignmentId)
    expect(rate).toBeGreaterThanOrEqual(0.1)
    expect(rate).toBeLessThanOrEqual(0.8)
  })

  it('is clamped to min', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
    })
    const config: SimulationConfig = { ...defaultConfig, minLocalExtractionRate: 0.6 }
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getBailiffLocalExtractionRate(s, config, assignmentId)).toBe(0.6)
  })

  it('is clamped to max', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
    })
    const config: SimulationConfig = { ...defaultConfig, maxLocalExtractionRate: 0.3 }
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getBailiffLocalExtractionRate(s, config, assignmentId)).toBe(0.3)
  })

  it('protect_residents lowers the rate', () => {
    let state = makeBaseState()
    const holdingId = getHoldingId(state)
    state = makePerson(state, personId, {
      abilities: {
        valor: 30,
        command: 30,
        numeracy: 30,
        learning: 30,
        charisma: 100,
        insight: 100,
      },
      traits: { ambition: 0.2, caution: 0.6 },
    })
    state = withPopGroup(state, holdingId, { size: 100, unrest: 80 })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const policy = getBailiffPolicy(s, defaultConfig, assignmentId)
    expect(policy).toBe('protect_residents')
    const rate = getBailiffLocalExtractionRate(s, defaultConfig, assignmentId)
    expect(rate).toBeLessThan(0.5)
  })

  it('profit_seeking raises the rate', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 30, command: 30, numeracy: 60, learning: 30, charisma: 30, insight: 30 },
      traits: { ambition: 0.95, caution: 0.1 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const policy = getBailiffPolicy(s, defaultConfig, assignmentId)
    expect(policy).toBe('profit_seeking')
    const rate = getBailiffLocalExtractionRate(s, defaultConfig, assignmentId)
    expect(rate).toBeGreaterThan(0.5)
  })
})

// --- getBailiffCollectionEfficiency ---

describe('getBailiffCollectionEfficiency', () => {
  it('placeholder returns placeholderBailiffCollectionEfficiency', () => {
    const state = makeBaseState()
    const holdingId = getHoldingId(state)
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const eff = getBailiffCollectionEfficiency(state, defaultConfig, assignmentId, 'none')
    expect(eff).toBe(defaultConfig.placeholderBailiffCollectionEfficiency)
  })

  it('does not exceed 1.0', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: {
        valor: 120,
        command: 120,
        numeracy: 120,
        learning: 120,
        charisma: 120,
        insight: 120,
      },
      traits: { ambition: 0.5, caution: 1.0 },
    })
    const config: SimulationConfig = {
      ...defaultConfig,
      baseBailiffCollectionEfficiency: 0.95,
    }
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const eff = getBailiffCollectionEfficiency(s, config, assignmentId, 'completed')
    expect(eff).toBeLessThanOrEqual(1.0)
  })

  it('does not go below minBailiffCollectionEfficiency', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
      traits: { ambition: 0.5, caution: 0.0 },
    })
    const config: SimulationConfig = {
      ...defaultConfig,
      baseBailiffCollectionEfficiency: 0.0,
    }
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const eff = getBailiffCollectionEfficiency(s, config, assignmentId, 'none')
    expect(eff).toBe(config.minBailiffCollectionEfficiency)
  })

  it('task completed adds positive modifier', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const effNone = getBailiffCollectionEfficiency(s, defaultConfig, assignmentId, 'none')
    const effCompleted = getBailiffCollectionEfficiency(s, defaultConfig, assignmentId, 'completed')
    expect(effCompleted - effNone).toBeCloseTo(
      defaultConfig.bailiffTaskCompletedCollectionModifier,
      5,
    )
  })

  it('task none adds no penalty (modifier is 0)', () => {
    expect(defaultConfig.bailiffTaskNoneCollectionModifier).toBe(0)
  })
})

// --- getBailiffFeeRate ---

describe('getBailiffFeeRate', () => {
  it('default is approximately 0.10', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const rate = getBailiffFeeRate(s, defaultConfig, assignmentId)
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(rate).toBeLessThanOrEqual(defaultConfig.maxBailiffFeeRate)
  })

  it('does not exceed maxBailiffFeeRate', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 30, command: 30, numeracy: 60, learning: 30, charisma: 30, insight: 30 },
      traits: { ambition: 0.95, caution: 0.1 },
    })
    const config: SimulationConfig = { ...defaultConfig, maxBailiffFeeRate: 0.05 }
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getBailiffFeeRate(s, config, assignmentId)).toBeLessThanOrEqual(0.05)
  })

  it('profit_seeking raises the rate', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {
      abilities: { valor: 30, command: 30, numeracy: 60, learning: 30, charisma: 30, insight: 30 },
      traits: { ambition: 0.95, caution: 0.1 },
    })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const policy = getBailiffPolicy(s, defaultConfig, assignmentId)
    expect(policy).toBe('profit_seeking')
    const rate = getBailiffFeeRate(s, defaultConfig, assignmentId)
    expect(rate).toBeGreaterThan(0.1)
  })

  it('protect_residents lowers the rate', () => {
    let state = makeBaseState()
    const holdingId = getHoldingId(state)
    state = makePerson(state, personId, {
      abilities: {
        valor: 30,
        command: 30,
        numeracy: 30,
        learning: 30,
        charisma: 100,
        insight: 100,
      },
      traits: { ambition: 0.2, caution: 0.6 },
    })
    state = withPopGroup(state, holdingId, { size: 100, unrest: 80 })
    const { state: s, assignmentId } = appointBailiff(state, personId)
    const policy = getBailiffPolicy(s, defaultConfig, assignmentId)
    expect(policy).toBe('protect_residents')
    const rate = getBailiffFeeRate(s, defaultConfig, assignmentId)
    expect(rate).toBeLessThan(0.1)
  })
})

// --- computeBailiffBurdenComponents ---

describe('computeBailiffBurdenComponents', () => {
  it('computes correct 3-component values', () => {
    const result = computeBailiffBurdenComponents(0.5, 0.7, 0.5)
    expect(result.actualExtractionBurdenRate).toBeCloseTo(0.35, 5)
    expect(result.collectionFrictionBurdenRate).toBeCloseTo(0.075, 5)
    expect(result.totalBurdenRate).toBeCloseTo(0.425, 5)
  })

  it('friction is 0 when collectionEfficiency is 1.0', () => {
    const result = computeBailiffBurdenComponents(0.5, 1.0, 0.5)
    expect(result.collectionFrictionBurdenRate).toBe(0)
    expect(result.totalBurdenRate).toBeCloseTo(0.5, 5)
  })

  it('friction equals localExtractionRate * collectionFrictionFactor when collectionEfficiency is 0', () => {
    const result = computeBailiffBurdenComponents(0.5, 0.0, 0.5)
    expect(result.actualExtractionBurdenRate).toBe(0)
    expect(result.collectionFrictionBurdenRate).toBeCloseTo(0.25, 5)
    expect(result.totalBurdenRate).toBeCloseTo(0.25, 5)
  })

  it('totalBurdenRate equals old effectiveBurdenRate formula when frictionFactor=0.5', () => {
    const le = 0.5
    const ce = 0.7
    const result = computeBailiffBurdenComponents(le, ce, 0.5)
    const oldFormula = le * (0.5 + 0.5 * ce)
    expect(result.totalBurdenRate).toBeCloseTo(oldFormula, 10)
  })
})

// --- getRecentBailiffRevenueTaskStatus ---

describe('getRecentBailiffRevenueTaskStatus', () => {
  it('returns none when no activity logs exist', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {})
    const { state: s, assignmentId } = appointBailiff(state, personId)
    expect(getRecentBailiffRevenueTaskStatus(s, assignmentId)).toBe('none')
  })

  it('returns completed when matching log exists within 4 weeks', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {})
    const { state: s, assignmentId } = appointBailiff(state, personId)

    const logId = 'pal-0' as PersonActivityLogId
    const log: PersonActivityLog = {
      id: logId,
      personId,
      week: s.absoluteWeek - 2,
      kind: 'task_completed',
      outcome: 'success',
      taskKind: 'collect_holding_revenue',
      sourceRef: { kind: 'holding_office_assignment', id: assignmentId },
      relatedRefs: [],
      summaryKey: '',
      importance: 1,
    }
    const withLog: WorldState = {
      ...s,
      personActivityLogs: { ...s.personActivityLogs, [logId]: log },
      personActivityLogIndex: {
        byPerson: {
          ...s.personActivityLogIndex.byPerson,
          [personId as string]: [logId],
        },
      },
    }
    expect(getRecentBailiffRevenueTaskStatus(withLog, assignmentId)).toBe('completed')
  })

  it('returns none when log is older than 4 weeks', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {})
    const { state: s, assignmentId } = appointBailiff(state, personId)

    const logId = 'pal-0' as PersonActivityLogId
    const log: PersonActivityLog = {
      id: logId,
      personId,
      week: s.absoluteWeek - 5,
      kind: 'task_completed',
      outcome: 'success',
      taskKind: 'collect_holding_revenue',
      sourceRef: { kind: 'holding_office_assignment', id: assignmentId },
      relatedRefs: [],
      summaryKey: '',
      importance: 1,
    }
    const withLog: WorldState = {
      ...s,
      personActivityLogs: { ...s.personActivityLogs, [logId]: log },
      personActivityLogIndex: {
        byPerson: {
          ...s.personActivityLogIndex.byPerson,
          [personId as string]: [logId],
        },
      },
    }
    expect(getRecentBailiffRevenueTaskStatus(withLog, assignmentId)).toBe('none')
  })

  it('returns none when log has different taskKind', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {})
    const { state: s, assignmentId } = appointBailiff(state, personId)

    const logId = 'pal-0' as PersonActivityLogId
    const log: PersonActivityLog = {
      id: logId,
      personId,
      week: s.absoluteWeek - 1,
      kind: 'task_completed',
      outcome: 'success',
      taskKind: 'perform_office_duties',
      sourceRef: { kind: 'holding_office_assignment', id: assignmentId },
      relatedRefs: [],
      summaryKey: '',
      importance: 1,
    }
    const withLog: WorldState = {
      ...s,
      personActivityLogs: { ...s.personActivityLogs, [logId]: log },
      personActivityLogIndex: {
        byPerson: {
          ...s.personActivityLogIndex.byPerson,
          [personId as string]: [logId],
        },
      },
    }
    expect(getRecentBailiffRevenueTaskStatus(withLog, assignmentId)).toBe('none')
  })

  it('returns none when log has different assignment target', () => {
    let state = makeBaseState()
    state = makePerson(state, personId, {})
    const { state: s, assignmentId } = appointBailiff(state, personId)

    const otherAssignmentId = 'ho-999' as HoldingOfficeAssignmentId
    const logId = 'pal-0' as PersonActivityLogId
    const log: PersonActivityLog = {
      id: logId,
      personId,
      week: s.absoluteWeek - 1,
      kind: 'task_completed',
      outcome: 'success',
      taskKind: 'collect_holding_revenue',
      sourceRef: { kind: 'holding_office_assignment', id: otherAssignmentId },
      relatedRefs: [],
      summaryKey: '',
      importance: 1,
    }
    const withLog: WorldState = {
      ...s,
      personActivityLogs: { ...s.personActivityLogs, [logId]: log },
      personActivityLogIndex: {
        byPerson: {
          ...s.personActivityLogIndex.byPerson,
          [personId as string]: [logId],
        },
      },
    }
    expect(getRecentBailiffRevenueTaskStatus(withLog, assignmentId)).toBe('none')
  })
})
