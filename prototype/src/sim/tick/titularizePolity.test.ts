// v0.47 §6 titular 化 / 廃止のユニットテスト。
// - landless rank 2〜4 normal Polity → titular 化 (active 維持・leader 以外 office revoke)
// - landless rank 5 normal Polity → 廃止 (active=false)
// - titular Polity の ownerHouse 断絶 → 廃止 (fallback 補充なし)

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createGoalId,
} from '../types/ids'
import type { Goal } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runPolityOwnerConsistencySystem } from './polityOwnerConsistencySystem'
import { runGoalMaintenanceSystem } from './goalMaintenanceSystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import { getOfficeAssignments } from '../selectors/officeSelectors'
import { getActiveGoalForOwner } from '../selectors/goalSelectors'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

const leaderId = createPersonId('pe', 0)
const adminId = createPersonId('pe', 1)
const houseId = createHouseId('dh', 0)
const provinceId = createProvinceId('p', 0)
const polityId = createPolityId('dp', 0)

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

// rank と ownerHouse を指定して、leader + administrator office を持つ landed polity を作る。
function makeLandedPolity(rank: 2 | 3 | 4 | 5): WorldState {
  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, provinceId, { nameKey: 'Province0' })
  s = withHouse(s, houseId, {
    nameKey: 'House0',
    memberIds: [leaderId, adminId],
    seatProvinceId: provinceId,
  })
  s = withPolity(s, polityId, { rank, ownerHouseId: houseId, capitalProvinceId: provinceId })
  s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
  s = withPerson(s, leaderId, { nameKey: 'Leader', houseId, alive: true, age: 40 })
  s = withPerson(s, adminId, { nameKey: 'Admin', houseId, alive: true, age: 35 })
  s = createOfficeAssignment(s, { kind: 'polity', id: polityId }, 'leader', leaderId)
  s = createOfficeAssignment(s, { kind: 'polity', id: polityId }, 'administrator', adminId)
  return s
}

// LandContract を全削除して polity を landless にする。
function makeLandless(s: WorldState): WorldState {
  return {
    ...s,
    landContracts: {},
    landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
  }
}

describe('v0.47 titular 化 / 廃止', () => {
  it('landless rank 3 normal Polity を titular 化する (active 維持・leader 以外 office revoke)', () => {
    const landed = makeLandedPolity(3)
    const result = runPolityOwnerConsistencySystem(makeCtx(makeLandless(landed)))
    const polity = result.state.polities[polityId]!
    expect(polity.active).toBe(true)
    expect(polity.territorialStatus).toBe('titular')
    expect(polity.ownerHouseId).toBe(houseId)
    // leader は維持、administrator は revoke
    expect(getPolityLeader(result.state, polityId)).toBe(leaderId)
    const activePolityOffices = getOfficeAssignments(result.state, { kind: 'polity', id: polityId })
      .filter((o) => o.active)
      .map((o) => o.role)
    expect(activePolityOffices).toEqual(['leader'])
    expect(result.events.some((e) => e.type === 'POLITY_TITULARIZED')).toBe(true)
  })

  it('titular 化時に polity-owned の active Goal を abandoned にする (v0.47.5)', () => {
    const landed = makeLandedPolity(3)
    const base = makeLandless(landed)
    const goalId = createGoalId(0)
    const ownerKey = decisionSubjectKey({ kind: 'polity', id: polityId })
    const goal: Goal = {
      id: goalId,
      owner: { kind: 'polity', id: polityId },
      kind: 'internal_development',
      priority: 1,
      progress: 0,
      targetProgress: 100,
      createdWeek: base.absoluteWeek,
      minimumUntilWeek: base.absoluteWeek + 52,
      lastReviewWeek: base.absoluteWeek,
      nextReviewWeek: base.absoluteWeek + 48,
      status: 'active',
      reasonIds: [],
    }
    const withGoal: WorldState = {
      ...base,
      goals: { ...base.goals, [goalId]: goal },
      goalIndex: {
        ...base.goalIndex,
        byOwner: { ...base.goalIndex.byOwner, [ownerKey]: [goalId] },
      },
    }
    const result = runPolityOwnerConsistencySystem(makeCtx(withGoal))
    expect(result.state.polities[polityId]!.territorialStatus).toBe('titular')
    expect(result.state.goals[goalId]!.status).toBe('abandoned')
  })

  it('landless rank 5 normal Polity を廃止する (active=false)', () => {
    const landed = makeLandedPolity(5)
    const result = runPolityOwnerConsistencySystem(makeCtx(makeLandless(landed)))
    const polity = result.state.polities[polityId]!
    expect(polity.active).toBe(false)
    expect(result.events.some((e) => e.type === 'POLITY_ABOLISHED')).toBe(true)
  })

  it('titular Polity には GoalMaintenance が Goal を生成しない (v0.47.5, 空回り停止の核心)', () => {
    const landed = makeLandedPolity(3)
    // 実際に titular 化してから goalMaintenance を回す
    const titular = runPolityOwnerConsistencySystem(makeCtx(makeLandless(landed))).state
    expect(titular.polities[polityId]!.territorialStatus).toBe('titular')
    expect(getActiveGoalForOwner(titular, { kind: 'polity', id: polityId })).toBeUndefined()
    // review boundary (absoluteWeek % goalReviewIntervalWeeks === 0) で生成判定が走る週
    expect(titular.absoluteWeek % defaultConfig.goalReviewIntervalWeeks).toBe(0)
    const result = runGoalMaintenanceSystem(makeCtx(titular))
    // titular は対象外 → Goal が生成されない (除外しないと毎年空回り再生成する)
    expect(getActiveGoalForOwner(result.state, { kind: 'polity', id: polityId })).toBeUndefined()
  })

  it('territorial Polity には GoalMaintenance が Goal を生成する (対比)', () => {
    const landed = makeLandedPolity(3)
    expect(landed.absoluteWeek % defaultConfig.goalReviewIntervalWeeks).toBe(0)
    const result = runGoalMaintenanceSystem(makeCtx(landed))
    expect(getActiveGoalForOwner(result.state, { kind: 'polity', id: polityId })).toBeDefined()
  })

  it('titular Polity の ownerHouse 断絶で廃止する (fallback 補充なし)', () => {
    const landed = makeLandedPolity(3)
    // 1 度 titular 化
    const titularState = runPolityOwnerConsistencySystem(makeCtx(makeLandless(landed))).state
    expect(titularState.polities[polityId]!.territorialStatus).toBe('titular')
    // ownerHouse を inactive にする
    const ownerExtinct: WorldState = {
      ...titularState,
      houses: {
        ...titularState.houses,
        [houseId]: { ...titularState.houses[houseId]!, active: false },
      },
    }
    const result = runPolityOwnerConsistencySystem(makeCtx(ownerExtinct))
    expect(result.state.polities[polityId]!.active).toBe(false)
    expect(result.events.some((e) => e.type === 'POLITY_ABOLISHED')).toBe(true)
  })
})
