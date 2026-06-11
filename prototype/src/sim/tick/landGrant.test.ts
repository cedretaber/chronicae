// v0.47 §8-9 分封 (request_land_grant) のユニットテスト。
// consolidated な default world では donor 構造 (houseless office holder / 余剰 polity) が
// 自然発生しにくいため、構築 state で finalize_land_grant の解決を決定的に検証する。

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
import { runProjectTaskGenerationSystem } from './projectTaskGenerationSystem'
import { collectIntegrityErrors } from './integritySystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import { meetsLandGrantPetitionerGate } from '../selectors/petitionSelectors'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  withHolding,
  bindProvinceToPolity,
  withGoal,
  DEFAULT_ABILITIES,
} from '../testFixtures'
import type { RequestLandGrantProject } from '../types/project'
import type { Aim } from '../types/goal'
import type { Person } from '../types/person'

const leaderId = createPersonId('pe', 0)
const petitionerId = createPersonId('pe', 1)
const houseId = createHouseId('dh', 0)
const donorPolityId = createPolityId('dp', 0)
const provinceId = createProvinceId('p', 0)
const h0 = createHoldingId(0)
const h1 = createHoldingId(1)
const h2 = createHoldingId(2)

// donor Polity (rank 3) が 3 holding を持ち、houseless petitioner が其処の administrator を務める状態。
function makeLandGrantState(): WorldState {
  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, provinceId, { nameKey: 'Province0', holdingIds: [h0, h1, h2] })
  s = withHolding(s, h0, provinceId, { nameKey: 'Holding0' })
  s = withHolding(s, h1, provinceId, { nameKey: 'Holding1' })
  s = withHolding(s, h2, provinceId, { nameKey: 'Holding2' })
  s = withHouse(s, houseId, {
    nameKey: 'House0',
    memberIds: [leaderId],
    seatProvinceId: provinceId,
  })
  s = withPolity(s, donorPolityId, {
    rank: 3,
    ownerHouseId: houseId,
    capitalProvinceId: provinceId,
  })
  s = bindProvinceToPolity(s, provinceId, donorPolityId)
  s = withPerson(s, leaderId, { nameKey: 'Leader', houseId, alive: true, age: 45 })
  // petitioner は houseless・wealth 十分・donor polity の administrator (在職先 = donor)。
  //   withPerson は houseId 必須のため houseless 人物は inline 構築する。
  const petitioner: Person = {
    id: petitionerId,
    nameKey: 'Petitioner',
    sex: 'male',
    age: 30,
    lifeStage: 'mature_adulthood',
    alive: true,
    childIds: [],
    birthStatus: 'legitimate',
    abilities: { ...DEFAULT_ABILITIES },
    aptitudes: { ...DEFAULT_ABILITIES },
    traits: { ambition: 0.6, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 1000,
    attitudes: {},
  }
  s = {
    ...s,
    persons: { ...s.persons, [petitionerId]: petitioner },
    livingPersonIds: [...s.livingPersonIds, petitionerId].sort(),
  }
  s = createOfficeAssignment(s, { kind: 'polity', id: donorPolityId }, 'leader', leaderId)
  s = createOfficeAssignment(
    s,
    { kind: 'polity', id: donorPolityId },
    'administrator',
    petitionerId,
  )
  return s
}

// finalize_land_grant stage の request_land_grant project を state に積む。
function withFinalizeLandGrantProject(s0: WorldState): WorldState {
  const projectId = createProjectId(0)
  const aimId = createAimId(0)
  const goalId = createGoalId(0)
  const s = withGoal(s0, goalId, { kind: 'person', id: petitionerId }, 'personal_advancement')
  const aim: Aim = {
    id: aimId,
    owner: { kind: 'person', id: petitionerId },
    goalId,
    origin: 'goal_driven',
    kind: 'request_land_grant',
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
  const project: RequestLandGrantProject = {
    id: projectId,
    owner: { kind: 'person', id: petitionerId },
    origin: { kind: 'aim', aimId },
    kind: 'request_land_grant',
    creatorPersonId: petitionerId,
    supervisorPersonId: petitionerId,
    status: 'active',
    progress: 3,
    targetProgress: 3,
    currentStageKey: 'finalize_land_grant',
    createdWeek: s.absoluteWeek,
    reasonIds: [],
    petitionerPersonId: petitionerId,
    donorPolityId,
    targetHoldingId: h2,
    approverPersonId: leaderId,
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

describe('v0.47 分封 (request_land_grant) finalize', () => {
  it('houseless petitioner が分封を受け新 House + rank5 Polity を得る', () => {
    const s = withFinalizeLandGrantProject(makeLandGrantState())
    // fixture 自体が持つ既知の integrity ノイズ (孤立 province・bailiff 重複等) を baseline 化し、
    // land-grant が新たに導入した違反だけを isolate する。
    const baselineErrors = new Set(
      collectIntegrityErrors(s, { debug: false, config: defaultConfig }).map((e) => e.message),
    )
    // approver attitude が低くても auto-grant に近い閾値で通すため threshold を緩める。
    const ctx = {
      ...makeCtx(s),
      config: { ...defaultConfig, landGrantAcceptThreshold: -9999 },
    }
    const result = runProjectStageSystem(ctx)
    const st = result.state

    // project 完了。
    const project = st.projects[createProjectId(0)]
    expect(project?.status).toBe('completed')

    // 新 rank5 land_grant Polity が生成される。
    const newPolity = Object.values(st.polities).find((p) => p.origin.kind === 'land_grant')
    expect(newPolity).toBeDefined()
    expect(newPolity!.rank).toBe(5)
    expect(newPolity!.territorialStatus).toBe('territorial')
    expect(newPolity!.nameSource.kind).toBe('holding')

    // 新 House (self_made_foundation / land_grant) が生成され petitioner が founder。
    const newHouse = Object.values(st.houses).find(
      (h) => h.creationReason === 'land_grant' && h.founderId === petitionerId,
    )
    expect(newHouse).toBeDefined()
    expect(newHouse!.creationKind).toBe('self_made_foundation')
    expect(newPolity!.ownerHouseId).toBe(newHouse!.id)

    // petitioner は新 House 所属 + 新 Polity leader。
    expect(st.persons[petitionerId]!.houseId).toBe(newHouse!.id)
    expect(getPolityLeader(st, newPolity!.id)).toBe(petitionerId)

    // per-holding terminal 支配を holdingTerminalPolityCache で確認 (同一 province 内 grant は
    // province 粒度の getPolityHoldingCount では区別できないため cache で数える)。
    const donorHoldings = [h0, h1, h2].filter(
      (h) => st.holdingTerminalPolityCache[h] === donorPolityId,
    )
    const newHoldings = [h0, h1, h2].filter(
      (h) => st.holdingTerminalPolityCache[h] === newPolity!.id,
    )
    expect(donorHoldings.length).toBe(2)
    expect(newHoldings.length).toBe(1)

    // events。
    expect(result.events.some((e) => e.type === 'POLITY_GRANTED')).toBe(true)
    expect(result.events.some((e) => e.type === 'HOUSE_FOUNDED_BY_LAND_GRANT')).toBe(true)

    // land-grant が新規に導入した integrity 違反が無いこと (baseline ノイズ + 完了 project の
    // 未掃引 mid-tick 状態は除外。production では後段の flushTerminalEntities が掃引する)。
    const newErrors = collectIntegrityErrors(st, { debug: false, config: defaultConfig })
      .map((e) => e.message)
      .filter((m) => !baselineErrors.has(m) && !m.includes('terminal project in state'))
    expect(newErrors).toEqual([])
  })

  it('preparatory stage (prepare_petition) が prepare_project task を生成する (stall しない)', () => {
    // PREPARATORY_TASK_KIND_MAP 未登録だと projectTaskGenerationSystem が task を生成せず
    // petition project が prepare_petition で永久 stall する。登録済みであることを確認する。
    let s = withFinalizeLandGrantProject(makeLandGrantState())
    // project を prepare_petition (最初の preparatory stage) に戻す。
    const projectId = createProjectId(0)
    const p = s.projects[projectId]!
    s = {
      ...s,
      projects: {
        ...s.projects,
        [projectId]: { ...p, currentStageKey: 'prepare_petition', progress: 0 },
      },
    }
    const result = runProjectTaskGenerationSystem(makeCtx(s))
    const tasks = Object.values(result.state.tasks).filter(
      (t) => t.targetRef.kind === 'project' && t.targetRef.id === projectId,
    )
    expect(tasks.length).toBe(1)
    expect(tasks[0]!.kind).toBe('prepare_project')
  })
})

// v0.47.x: house leader は分封 petition から除外する (現 House を放棄して house:leader office を
//   dangling 化させる整合違反 = 「house leader が memberIds に居ない」の再発防止)。
//   meetsCadetBranchPetitionerGate の leader 除外と対称。houseless は対象外 (自立路)。
describe('meetsLandGrantPetitionerGate: house leader 除外', () => {
  const gateHouseId = createHouseId('h', 7)
  const gatePolityId = createPolityId('c', 7)
  const gateProvinceId = createProvinceId('p', 7)
  const houseLeaderId = createPersonId('pe', 70)
  const cadetMemberId = createPersonId('pe', 71)

  // house leader と非 leader member が、同条件 (wealth 十分 + active polity office) で並ぶ state。
  function makeGateState(): WorldState {
    let s = makeEmptyV016State()
    s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    s = withProvince(s, gateProvinceId, { nameKey: 'GateProvince' })
    s = withHouse(s, gateHouseId, {
      nameKey: 'GateHouse',
      memberIds: [houseLeaderId, cadetMemberId],
      seatProvinceId: gateProvinceId,
    })
    s = withPolity(s, gatePolityId, {
      rank: 3,
      ownerHouseId: gateHouseId,
      capitalProvinceId: gateProvinceId,
    })
    s = bindProvinceToPolity(s, gateProvinceId, gatePolityId)
    s = withPerson(s, houseLeaderId, { nameKey: 'GateLeader', houseId: gateHouseId, wealth: 1000 })
    s = withPerson(s, cadetMemberId, { nameKey: 'GateCadet', houseId: gateHouseId, wealth: 1000 })
    // house:leader office (getHouseLeader が参照する) を houseLeaderId に。
    s = createOfficeAssignment(s, { kind: 'house', id: gateHouseId }, 'leader', houseLeaderId)
    // 実績条件を満たすため両者に active polity office を与える。
    s = createOfficeAssignment(s, { kind: 'polity', id: gatePolityId }, 'leader', houseLeaderId)
    s = createOfficeAssignment(
      s,
      { kind: 'polity', id: gatePolityId },
      'administrator',
      cadetMemberId,
    )
    return s
  }

  it('house leader は gate を通過しない', () => {
    const s = makeGateState()
    const leader = s.persons[houseLeaderId]!
    expect(meetsLandGrantPetitionerGate(s, defaultConfig, leader)).toBe(false)
  })

  it('同条件の非 leader member は gate を通過する (対照)', () => {
    const s = makeGateState()
    const cadet = s.persons[cadetMemberId]!
    expect(meetsLandGrantPetitionerGate(s, defaultConfig, cadet)).toBe(true)
  })
})
