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
import type { PolityId } from '../types/ids'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runProjectStageSystem } from './projectStageSystem'
import { runProjectTaskGenerationSystem } from './projectTaskGenerationSystem'
import { collectIntegrityErrors } from './integritySystem'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { createHouseShare } from '../mutations/shareMutations'
import { setPersonAttitude } from '../mutations/attitudeMutations'
import { getPolityLeader } from '../selectors/officeSelectors'
import {
  meetsLandGrantPetitionerGate,
  selectLandGrantDonorPolity,
  resolveLandGrantDonor,
} from '../selectors/petitionSelectors'
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

    // 分封の家名は受領した領国 (holding 名由来) の名前を snapshot する (王朝名として固定・person 名でない)。
    const polityNameSource = newPolity!.nameSource
    expect(polityNameSource.kind).toBe('holding')
    if (polityNameSource.kind === 'holding') {
      expect(newHouse!.nameKey).toBe(st.holdings[polityNameSource.holdingId]!.nameKey)
    }
    expect(newHouse!.nameSource).toEqual({ kind: 'polity', category: 'province' })

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

// 有家分封の primary donor 解禁 (家統制ゲート)。
//   家の権力が分散 (筆頭 share ≤ landGrantCoreDonorMaxTopSharePercent) していれば本拠 (primary) を
//   donor 解禁し、集中していれば本拠を割らせない。sink (≠primary) は分散でも常に除外。
describe('有家分封 primary donor 解禁 (Layer1: 集中度ゲート)', () => {
  const cohHouseId = createHouseId('dh', 5)
  const cohLeaderId = createPersonId('pe', 50)
  const cohPetitionerId = createPersonId('pe', 51)
  const cohProvinceA = createProvinceId('p', 5)
  const cohProvinceB = createProvinceId('p', 6)
  const cohPolityA = createPolityId('dp', 5)
  const cohPolityB = createPolityId('dp', 6)
  const ah0 = createHoldingId(50)
  const ah1 = createHoldingId(51)
  const ah2 = createHoldingId(52)
  const bh0 = createHoldingId(60)
  const bh1 = createHoldingId(61)
  const bh2 = createHoldingId(62)

  // 共通: leader + petitioner の有家、shares を seed。petitioner は polity office で gate 通過。
  function seedMembersAndShares(
    s0: WorldState,
    officePolityId: PolityId,
    leaderShare: number,
    petitionerShare: number,
  ): WorldState {
    let s = withPerson(s0, cohLeaderId, {
      nameKey: 'CohLeader',
      houseId: cohHouseId,
      alive: true,
      age: 50,
      wealth: 1000,
    })
    s = withPerson(s, cohPetitionerId, {
      nameKey: 'CohPetitioner',
      houseId: cohHouseId,
      alive: true,
      age: 30,
      wealth: 1000,
    })
    // house:leader は leader、petitioner は polity office で実績条件を満たす (gate)。
    s = createOfficeAssignment(s, { kind: 'house', id: cohHouseId }, 'leader', cohLeaderId)
    s = createOfficeAssignment(
      s,
      { kind: 'polity', id: officePolityId },
      'administrator',
      cohPetitionerId,
    )
    s = createHouseShare(s, cohHouseId, cohLeaderId, leaderShare)
    s = createHouseShare(s, cohHouseId, cohPetitionerId, petitionerShare)
    return s
  }

  // 1 polity (rank3 seat, 3 holdings) の有家。primary == sink == polityA。
  function make1PolityState(leaderShare: number, petitionerShare: number): WorldState {
    let s = makeEmptyV016State()
    s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    s = withProvince(s, cohProvinceA, { nameKey: 'CohProvinceA', holdingIds: [ah0, ah1, ah2] })
    s = withHolding(s, ah0, cohProvinceA, { nameKey: 'AH0' })
    s = withHolding(s, ah1, cohProvinceA, { nameKey: 'AH1' })
    s = withHolding(s, ah2, cohProvinceA, { nameKey: 'AH2' })
    s = withHouse(s, cohHouseId, {
      nameKey: 'CohHouse',
      memberIds: [cohLeaderId, cohPetitionerId],
      seatProvinceId: cohProvinceA,
    })
    s = withPolity(s, cohPolityA, {
      rank: 3,
      ownerHouseId: cohHouseId,
      capitalProvinceId: cohProvinceA,
    })
    s = bindProvinceToPolity(s, cohProvinceA, cohPolityA)
    return seedMembersAndShares(s, cohPolityA, leaderShare, petitionerShare)
  }

  // 2 polity (primary A rank3 seat / 第二 B) の有家。B の rank で sink を制御。分散 shares 固定。
  function make2PolityState(secondRank: 2 | 4): WorldState {
    let s = makeEmptyV016State()
    s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    s = withProvince(s, cohProvinceA, { nameKey: 'CohProvinceA', holdingIds: [ah0, ah1, ah2] })
    s = withHolding(s, ah0, cohProvinceA, { nameKey: 'AH0' })
    s = withHolding(s, ah1, cohProvinceA, { nameKey: 'AH1' })
    s = withHolding(s, ah2, cohProvinceA, { nameKey: 'AH2' })
    s = withProvince(s, cohProvinceB, { nameKey: 'CohProvinceB', holdingIds: [bh0, bh1, bh2] })
    s = withHolding(s, bh0, cohProvinceB, { nameKey: 'BH0' })
    s = withHolding(s, bh1, cohProvinceB, { nameKey: 'BH1' })
    s = withHolding(s, bh2, cohProvinceB, { nameKey: 'BH2' })
    s = withHouse(s, cohHouseId, {
      nameKey: 'CohHouse',
      memberIds: [cohLeaderId, cohPetitionerId],
      seatProvinceId: cohProvinceA,
    })
    s = withPolity(s, cohPolityA, {
      rank: 3,
      ownerHouseId: cohHouseId,
      capitalProvinceId: cohProvinceA,
    })
    s = withPolity(s, cohPolityB, {
      rank: secondRank,
      ownerHouseId: cohHouseId,
      capitalProvinceId: cohProvinceB,
    })
    s = bindProvinceToPolity(s, cohProvinceA, cohPolityA)
    s = bindProvinceToPolity(s, cohProvinceB, cohPolityB)
    return seedMembersAndShares(s, cohPolityA, 50, 50)
  }

  it('1-polity・分散 (筆頭 50% ≤ 60) → primary が donor になり分封成立', () => {
    const s = make1PolityState(50, 50)
    expect(selectLandGrantDonorPolity(s, defaultConfig, cohPetitionerId)).toBe(cohPolityA)
    const resolved = resolveLandGrantDonor(s, defaultConfig, cohPetitionerId)
    expect(resolved?.donorPolityId).toBe(cohPolityA)
    expect(resolved?.holdingId).toBeDefined()
  })

  it('1-polity・集中 (筆頭 90% > 60) → donor 候補ゼロで分封不成立', () => {
    const s = make1PolityState(90, 10)
    expect(selectLandGrantDonorPolity(s, defaultConfig, cohPetitionerId)).toBeUndefined()
    expect(resolveLandGrantDonor(s, defaultConfig, cohPetitionerId)).toBeUndefined()
  })

  it('多 polity・分散: 純 sink (≠primary) は除外、primary は解禁される', () => {
    // B rank2 → sink = B (≠ primary A)。分散でも B は除外、唯一の候補 primary A が返る。
    const s = make2PolityState(2)
    expect(selectLandGrantDonorPolity(s, defaultConfig, cohPetitionerId)).toBe(cohPolityA)
  })

  it('多 polity・分散: 非 core (secondary) が core (primary) より優先される', () => {
    // B rank4 → sink = A (=primary)。B は純 secondary。非 core 優先で B が返る。
    const s = make2PolityState(4)
    expect(selectLandGrantDonorPolity(s, defaultConfig, cohPetitionerId)).toBe(cohPolityB)
  })

  // Layer2: 有家分封の accept は家 share 加重意見 (getWeightedOpinionFromHouseShareholders) + progress。
  describe('Layer2: 有家 accept = 家 share 加重意見', () => {
    function withHousedFinalizeProject(s0: WorldState): WorldState {
      const projectId = createProjectId(0)
      const aimId = createAimId(0)
      const goalId = createGoalId(0)
      const s = withGoal(
        s0,
        goalId,
        { kind: 'person', id: cohPetitionerId },
        'personal_advancement',
      )
      const aim: Aim = {
        id: aimId,
        owner: { kind: 'person', id: cohPetitionerId },
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
        owner: { kind: 'person', id: cohPetitionerId },
        origin: { kind: 'aim', aimId },
        kind: 'request_land_grant',
        creatorPersonId: cohPetitionerId,
        supervisorPersonId: cohPetitionerId,
        status: 'active',
        progress: 3,
        targetProgress: 3,
        currentStageKey: 'finalize_land_grant',
        createdWeek: s.absoluteWeek,
        reasonIds: [],
        petitionerPersonId: cohPetitionerId,
        donorPolityId: cohPolityA,
        targetHoldingId: ah2,
        approverPersonId: cohLeaderId,
      }
      return {
        ...s,
        aims: { ...s.aims, [aimId]: aim },
        aimIndex: {
          ...s.aimIndex,
          byOwner: { ...s.aimIndex.byOwner, [`person:${cohPetitionerId}`]: [aimId] },
        },
        projects: { ...s.projects, [projectId]: project },
        projectIndex: {
          ...s.projectIndex,
          byOwner: { ...s.projectIndex.byOwner, [`person:${cohPetitionerId}`]: [projectId] },
          byAim: { ...s.projectIndex.byAim, [aimId as string]: [projectId] },
        },
      }
    }

    function setLeaderAttitudeToPetitioner(
      s: WorldState,
      affection: number,
      respect: number,
    ): WorldState {
      const r = setPersonAttitude(
        s,
        cohLeaderId,
        { kind: 'person', id: cohPetitionerId },
        { affection, respect },
      )
      if (!r.ok) throw new Error(r.error.message)
      return r.value
    }

    function ctxFor(s: WorldState): TickContext {
      return makeCtx(s)
    }

    it('筆頭 holder が petitioner を支持 → 分封 completed + cadet house 生成', () => {
      // 分散 (50/50) で donor 解決可・leader (他 holder) の attitude を正に。
      let s = withHousedFinalizeProject(make1PolityState(50, 50))
      s = setLeaderAttitudeToPetitioner(s, 80, 80)
      const baselineErrors = new Set(
        collectIntegrityErrors(s, { debug: false, config: defaultConfig }).map((e) => e.message),
      )
      const result = runProjectStageSystem(ctxFor(s))
      const st = result.state
      expect(st.projects[createProjectId(0)]?.status).toBe('completed')
      const newHouse = Object.values(st.houses).find(
        (h) => h.creationReason === 'land_grant' && h.founderId === cohPetitionerId,
      )
      expect(newHouse?.creationKind).toBe('cadet_branch')
      expect(result.events.some((e) => e.type === 'CADET_BRANCH_FOUNDED_BY_LAND_GRANT')).toBe(true)
      const newErrors = collectIntegrityErrors(st, { debug: false, config: defaultConfig })
        .map((e) => e.message)
        .filter((m) => !baselineErrors.has(m) && !m.includes('terminal project in state'))
      expect(newErrors).toEqual([])
    })

    it('筆頭 holder が petitioner に反感 → 分封 failed (donor 解決はできても accept されない)', () => {
      let s = withHousedFinalizeProject(make1PolityState(50, 50))
      s = setLeaderAttitudeToPetitioner(s, -80, -80)
      const result = runProjectStageSystem(ctxFor(s))
      expect(result.state.projects[createProjectId(0)]?.status).toBe('failed')
    })
  })
})
