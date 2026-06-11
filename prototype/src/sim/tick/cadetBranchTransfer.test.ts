// v0.47 §11 Polity 譲渡による分家 (request_cadet_branch_title_transfer) のユニットテスト。
// default world に ≥2 polity 保有 House が無いため、構築 state で finalize_cadet_branch を
// 決定的に検証する。

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createHoldingId,
  createProjectId,
  createAimId,
  createGoalId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runProjectStageSystem } from './projectStageSystem'
import { collectIntegrityErrors } from './integritySystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createClan } from '../mutations/clanMutations'
import { getPolityLeader, getHouseLeader } from '../selectors/officeSelectors'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  withHolding,
  bindProvinceToPolity,
  withGoal,
} from '../testFixtures'
import type { RequestCadetBranchTitleTransferProject } from '../types/project'
import type { Aim } from '../types/goal'

const leaderId = createPersonId('pe', 0)
const petitionerId = createPersonId('pe', 1)
const houseId = createHouseId('dh', 0)
const primaryPolityId = createPolityId('dp', 0)
const secondaryPolityId = createPolityId('dp', 1)
const pv0 = createProvinceId('p', 0)
const pv1 = createProvinceId('p', 1)
const h0 = createHoldingId(0)
const h1 = createHoldingId(1)

// House が primary (rank2・seat) と secondary (rank3) の 2 Polity を持つ状態。
function makeTransferState(): WorldState {
  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, pv0, { nameKey: 'Province0', holdingIds: [h0] })
  s = withProvince(s, pv1, { nameKey: 'Province1', holdingIds: [h1] })
  s = withHolding(s, h0, pv0, { nameKey: 'Holding0' })
  s = withHolding(s, h1, pv1, { nameKey: 'Holding1' })
  s = withHouse(s, houseId, {
    nameKey: 'House0',
    memberIds: [leaderId, petitionerId],
    seatProvinceId: pv0,
  })
  s = withPolity(s, primaryPolityId, { rank: 2, ownerHouseId: houseId, capitalProvinceId: pv0 })
  s = withPolity(s, secondaryPolityId, { rank: 3, ownerHouseId: houseId, capitalProvinceId: pv1 })
  s = bindProvinceToPolity(s, pv0, primaryPolityId)
  s = bindProvinceToPolity(s, pv1, secondaryPolityId)
  s = withPerson(s, leaderId, { nameKey: 'Leader', houseId, alive: true, age: 50 })
  s = withPerson(s, petitionerId, {
    nameKey: 'Petitioner',
    houseId,
    alive: true,
    age: 28,
    lifeStage: 'mature_adulthood',
    traits: { ambition: 0.9, caution: 0.4 },
  })
  s = createOfficeAssignment(s, { kind: 'house', id: houseId }, 'leader', leaderId)
  s = createOfficeAssignment(s, { kind: 'polity', id: primaryPolityId }, 'leader', leaderId)
  s = createOfficeAssignment(s, { kind: 'polity', id: secondaryPolityId }, 'leader', leaderId)
  return s
}

function withFinalizeCadetProject(s0: WorldState): WorldState {
  const projectId = createProjectId(0)
  const aimId = createAimId(0)
  const goalId = createGoalId(0)
  const s = withGoal(s0, goalId, { kind: 'person', id: petitionerId }, 'personal_advancement')
  const aim: Aim = {
    id: aimId,
    owner: { kind: 'person', id: petitionerId },
    goalId,
    origin: 'goal_driven',
    kind: 'establish_cadet_branch',
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
  const project: RequestCadetBranchTitleTransferProject = {
    id: projectId,
    owner: { kind: 'person', id: petitionerId },
    origin: { kind: 'aim', aimId },
    kind: 'request_cadet_branch_title_transfer',
    creatorPersonId: petitionerId,
    supervisorPersonId: petitionerId,
    status: 'active',
    progress: 3,
    targetProgress: 3,
    currentStageKey: 'finalize_cadet_branch',
    createdWeek: s.absoluteWeek,
    reasonIds: [],
    petitionerPersonId: petitionerId,
    parentHouseId: houseId,
    targetPolityId: secondaryPolityId,
  }
  return {
    ...s,
    aims: { ...s.aims, [aimId]: aim },
    aimIndex: {
      ...s.aimIndex,
      byOwner: { ...s.aimIndex.byOwner, [`person:${petitionerId}`]: [aimId] },
    },
    projects: { ...s.projects, [projectId]: project },
    projectIndex: {
      ...s.projectIndex,
      byOwner: { ...s.projectIndex.byOwner, [`person:${petitionerId}`]: [projectId] },
      byAim: { ...s.projectIndex.byAim, [aimId as string]: [projectId] },
    },
  }
}

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

describe('v0.47 Polity 譲渡による分家 finalize', () => {
  it('低継承権 member が宗家の secondary Polity を譲られ cadet House を立てる', () => {
    const s = withFinalizeCadetProject(makeTransferState())
    const baselineErrors = new Set(
      collectIntegrityErrors(s, { debug: false, config: defaultConfig }).map((e) => e.message),
    )
    const ctx = {
      ...makeCtx(s),
      // 継承順位除外を無効化 + HouseShare 支持閾値を緩めて wiring を検証 (balance は defer)。
      config: {
        ...defaultConfig,
        cadetBranchExcludeTopSuccessionRanks: 0,
        cadetBranchMinAmbition: 0,
        cadetBranchTitleTransferSupportThreshold: -9999,
      },
    }
    const result = runProjectStageSystem(ctx)
    const st = result.state

    const project = st.projects[createProjectId(0)]
    expect(project?.status).toBe('completed')

    // cadet House (polity_grant) が生成され petitioner が founder。
    const cadetHouse = Object.values(st.houses).find(
      (h) => h.creationReason === 'polity_grant' && h.founderId === petitionerId,
    )
    expect(cadetHouse).toBeDefined()
    expect(cadetHouse!.creationKind).toBe('cadet_branch')
    expect(cadetHouse!.parentHouseId).toBe(houseId)
    // parent の cadetHouseIds に含まれる。
    expect(st.houses[houseId]!.cadetHouseIds).toContain(cadetHouse!.id)

    // secondary Polity の ownerHouse が cadet に付替され、petitioner が leader。
    expect(st.polities[secondaryPolityId]!.ownerHouseId).toBe(cadetHouse!.id)
    expect(getPolityLeader(st, secondaryPolityId)).toBe(petitionerId)
    // primary Polity は宗家のまま。
    expect(st.polities[primaryPolityId]!.ownerHouseId).toBe(houseId)

    // petitioner は cadet House 所属 + cadet House leader。
    expect(st.persons[petitionerId]!.houseId).toBe(cadetHouse!.id)
    expect(getHouseLeader(st, cadetHouse!.id)).toBe(petitionerId)

    expect(result.events.some((e) => e.type === 'CADET_BRANCH_FOUNDED_BY_TITLE_TRANSFER')).toBe(
      true,
    )
    expect(result.events.some((e) => e.type === 'POLITY_TITLE_TRANSFERRED')).toBe(true)

    const newErrors = collectIntegrityErrors(st, { debug: false, config: defaultConfig })
      .map((e) => e.message)
      .filter((m) => !baselineErrors.has(m) && !m.includes('terminal project in state'))
    expect(newErrors).toEqual([])
  })

  it('clan 所属の宗家から分家した cadet House は Clan.memberHouseIds に登録される (§17 C1)', () => {
    // 親家が clan 所属の場合、cadet House は clanId を継承する。これを memberHouseIds に
    // 登録し損ねると「clanId 有 ↔ memberHouseIds 不在」の C1 違反になる (CLI seed 42/150年で顕在化)。
    let s = makeTransferState()
    const clanResult = createClan(s, {
      rootHouseId: houseId,
      memberHouseIds: [houseId],
      createdWeek: s.absoluteWeek,
    })
    s = clanResult.state
    const clanId = clanResult.clan.id
    expect(s.houses[houseId]!.clanId).toBe(clanId)

    s = withFinalizeCadetProject(s)
    const baselineErrors = new Set(
      collectIntegrityErrors(s, { debug: false, config: defaultConfig }).map((e) => e.message),
    )
    const ctx = {
      ...makeCtx(s),
      config: {
        ...defaultConfig,
        cadetBranchExcludeTopSuccessionRanks: 0,
        cadetBranchMinAmbition: 0,
        cadetBranchTitleTransferSupportThreshold: -9999,
      },
    }
    const st = runProjectStageSystem(ctx).state

    const cadetHouse = Object.values(st.houses).find(
      (h) => h.creationReason === 'polity_grant' && h.founderId === petitionerId,
    )
    expect(cadetHouse).toBeDefined()
    // cadet House は clanId を継承し、Clan.memberHouseIds にも登録される。
    expect(cadetHouse!.clanId).toBe(clanId)
    expect(st.clans[clanId]!.memberHouseIds).toContain(cadetHouse!.id)

    const newErrors = collectIntegrityErrors(st, { debug: false, config: defaultConfig })
      .map((e) => e.message)
      .filter((m) => !baselineErrors.has(m) && !m.includes('terminal project in state'))
    expect(newErrors).toEqual([])
  })
})
