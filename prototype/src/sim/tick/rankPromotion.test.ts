// v0.47 §5 陞爵 (request_rank_promotion) のユニットテスト。
// rank headroom (grantor rank が newRank より上位) を持つ Polity の昇格を検証し、
// 昇格後も LandContract rank 不変 (grantor rank < grantee rank) が保たれることを確認する。

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createHoldingId,
  createProjectId,
  createAimId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { runProjectStageSystem } from './projectStageSystem'
import { collectIntegrityErrors } from './integritySystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  withHolding,
  bindProvinceToPolity,
} from '../testFixtures'
import type { RequestRankPromotionProject } from '../types/project'
import type { Aim } from '../types/goal'

const leaderId = createPersonId('pe', 0)
const houseId = createHouseId('dh', 0)
const polityId = createPolityId('dp', 0)
const provinceId = createProvinceId('p', 0)
const h0 = createHoldingId(0)

// root 直属 (grantor = root rank 0) の rank 3 Polity → rank 2 へ昇格可能な headroom を持つ。
function makePromotableState(): WorldState {
  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, provinceId, { nameKey: 'Province0', holdingIds: [h0] })
  s = withHolding(s, h0, provinceId, { nameKey: 'Holding0' })
  s = withHouse(s, houseId, {
    nameKey: 'House0',
    memberIds: [leaderId],
    seatProvinceId: provinceId,
  })
  s = withPolity(s, polityId, {
    rank: 3,
    ownerHouseId: houseId,
    capitalProvinceId: provinceId,
    treasury: 5000,
    legacyPrestige: 80,
    adminPower: 80,
  })
  s = bindProvinceToPolity(s, provinceId, polityId) // root 直属契約
  s = withPerson(s, leaderId, { nameKey: 'Leader', houseId, alive: true, age: 45 })
  s = createOfficeAssignment(s, { kind: 'house', id: houseId }, 'leader', leaderId)
  s = createOfficeAssignment(s, { kind: 'polity', id: polityId }, 'leader', leaderId)
  return s
}

function withFinalizePromotionProject(s: WorldState): WorldState {
  const projectId = createProjectId(0)
  const aimId = createAimId(0)
  const aim: Aim = {
    id: aimId,
    owner: { kind: 'polity', id: polityId },
    origin: 'goal_driven',
    kind: 'seek_rank_promotion',
    priority: 50,
    progress: 0,
    targetProgress: 3,
    createdWeek: s.absoluteWeek,
    deadlineWeek: s.absoluteWeek + 520,
    successfulProjectCount: 0,
    failedProjectCount: 0,
    status: 'active',
    reasonIds: [],
  }
  const project: RequestRankPromotionProject = {
    id: projectId,
    owner: { kind: 'polity', id: polityId },
    origin: { kind: 'aim', aimId },
    kind: 'request_rank_promotion',
    creatorPersonId: leaderId,
    supervisorPersonId: leaderId,
    status: 'active',
    progress: 3,
    targetProgress: 3,
    currentStageKey: 'finalize_promotion',
    createdWeek: s.absoluteWeek,
    reasonIds: [],
    polityId,
    newRank: 2,
    // grantor が root のみ → approver なし (auto-grant)。
  }
  return {
    ...s,
    aims: { ...s.aims, [aimId]: aim },
    aimIndex: {
      ...s.aimIndex,
      byOwner: { ...s.aimIndex.byOwner, [`polity:${polityId}`]: [aimId] },
    },
    projects: { ...s.projects, [projectId]: project },
    projectIndex: {
      ...s.projectIndex,
      byOwner: { ...s.projectIndex.byOwner, [`polity:${polityId}`]: [projectId] },
      byAim: { ...s.projectIndex.byAim, [aimId as string]: [projectId] },
    },
  }
}

function makeCtx(state: WorldState, config: SimulationConfig = defaultConfig): TickContext {
  return {
    state,
    rng: createRng('test'),
    config,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

describe('v0.47 陞爵 finalize', () => {
  it('root 直属 rank3 Polity が rank2 へ昇格し rank 不変が保たれる', () => {
    const s = withFinalizePromotionProject(makePromotableState())
    const baselineErrors = new Set(
      collectIntegrityErrors(s, { debug: false, config: defaultConfig }).map((e) => e.message),
    )
    // holding 数の gate を緩めて (1 holding でも通す)、approver 不在の auto-grant 経路を検証。
    const config: SimulationConfig = {
      ...defaultConfig,
      rankPromotionMinHoldingCountByRank: { 2: 1, 3: 1, 4: 1 },
    }
    const result = runProjectStageSystem(makeCtx(s, config))
    const st = result.state

    const project = st.projects[createProjectId(0)]
    expect(project?.status).toBe('completed')
    expect(st.polities[polityId]!.rank).toBe(2)
    expect(result.events.some((e) => e.type === 'POLITY_RANK_PROMOTED')).toBe(true)

    // rank 不変 (grantor rank < grantee rank) を含め新規違反なし。
    const newErrors = collectIntegrityErrors(st, { debug: false, config: defaultConfig })
      .map((e) => e.message)
      .filter((m) => !baselineErrors.has(m) && !m.includes('terminal project in state'))
    expect(newErrors).toEqual([])
  })
})
