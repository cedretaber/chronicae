// v0.42 §13 acquire_political_right のユニットテスト (spec §20.1)。
// - project completion で PoliticalRight が作成される
// - cost が owner House wealth から対象 Polity treasury へ移転する (§13.4)
// - 既存 right がある target には作成しない
// - influence ゲート未満の House では Aim が生成されない (§13.3)
// - 非 owner 開放: 候補 polity 列挙 (influence source 全被覆) + 上限ゲート + aim 枝刈り

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createProjectId,
  createGoalId,
  createHoldingId,
  createFactionId,
  createHoldingOfficeAssignmentId,
  createAimId,
} from '../types/ids'
import type { HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Goal, EntityRef } from '../types/goal'
import type { AcquirePoliticalRightProject } from '../types/project'
import type { PoliticalRightTargetRef } from '../types/politicalRight'
import type { Faction } from '../types/faction'
import type { HoldingOfficeAssignment } from '../types/landContract'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { runAimMaintenanceSystem } from './aimMaintenanceSystem'
import {
  pickAimForGoal,
  aimSlotKey,
  collectAcquireRightCandidatePolityIds,
} from '../selectors/goalSelectors'
import { findAcquirableRightTarget } from '../selectors/politicalRightSelectors'
import { getHouseOwnedPolityIds } from '../selectors/landContractSelectors'
import { getEffectiveOfficeMaxHolders } from '../selectors/officeSelectors'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { createChildLandContract } from '../mutations/landContractMutations'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  withHolding,
  withAim,
  bindProvinceToHouseViaPolity,
  bindProvinceToPolity,
} from '../testFixtures'

const polityId = createPolityId('dp', 0)
const houseId = createHouseId('dh', 0)
const leaderId = createPersonId('pe', 0)
const provinceId = createProvinceId('p', 0)

function makeState(): WorldState {
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  state = withProvince(state, provinceId, { nameKey: 'Province0' })
  state = withHouse(state, houseId, { nameKey: 'House0', seatProvinceId: provinceId, wealth: 200 })
  state = withPerson(state, leaderId, { houseId })
  state = withPolity(state, polityId, {
    ownerHouseId: houseId,
    treasury: 100,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  return state
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

function makeCompletedProject(state: WorldState): {
  state: WorldState
  project: AcquirePoliticalRightProject
} {
  const target = findAcquirableRightTarget(state, defaultConfig, houseId, polityId)
  if (!target) throw new Error('no acquirable target in fixture')
  const projectId = createProjectId(0)
  const project: AcquirePoliticalRightProject = {
    id: projectId,
    owner: { kind: 'house', id: houseId },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'acquire_political_right',
    creatorPersonId: leaderId,
    supervisorPersonId: leaderId,
    status: 'completed', // outcome は terminal status の project に適用される
    terminalReason: 'completed', // v0.44 §5.3: terminal は reason 必須 (award hook の fail-fast)
    progress: 100,
    targetProgress: 100,
    currentStageKey: 'execute_project',
    createdWeek: state.absoluteWeek,
    deadlineWeek: state.absoluteWeek + 48,
    reasonIds: [],
    polityId,
    target,
    budget: defaultConfig.acquirePoliticalRightBaseCost,
    spentBudget: 0,
  }
  const ws: WorldState = {
    ...state,
    projects: { [projectId]: project },
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
  }
  addProjectToIndexMut(ws, project)
  return { state: ws, project }
}

describe('acquire_political_right outcome (§13.4)', () => {
  it('creates the right and transfers the cost from house wealth to polity treasury', () => {
    const { state, project } = makeCompletedProject(makeState())
    const result = runProjectOutcomeSystem(makeCtx(state))

    const rights = Object.values(result.state.politicalRights)
    expect(rights).toHaveLength(1)
    expect(rights[0]!.holder).toEqual({ kind: 'house', id: houseId })
    expect(rights[0]!.polityId).toBe(polityId)
    expect(rights[0]!.target).toEqual(project.target)

    const cost = defaultConfig.acquirePoliticalRightBaseCost
    expect(result.state.houses[houseId]!.wealth).toBe(200 - cost)
    expect(result.state.polities[polityId]!.treasury).toBe(100 + cost)

    expect(result.events.some((e) => e.type === 'POLITICAL_RIGHT_GRANTED')).toBe(true)
  })

  it('does not create a right when the target already has one', () => {
    const base = makeState()
    const target = findAcquirableRightTarget(base, defaultConfig, houseId, polityId)!
    const otherHouseId = createHouseId('dh', 9)
    let state = withHouse(base, otherHouseId, { seatProvinceId: provinceId })
    const pre = createPoliticalRight(state, {
      polityId,
      target,
      holder: { kind: 'house', id: otherHouseId },
      grantedWeek: state.absoluteWeek,
    })
    if (!pre.ok) throw new Error('setup failed')
    state = pre.value.state

    // 同じ target を狙う completed project (fixture は同 target を選ぶ前提を崩すため直接構築)
    const { state: ws } = (() => {
      const projectId = createProjectId(0)
      const project: AcquirePoliticalRightProject = {
        id: projectId,
        owner: { kind: 'house', id: houseId },
        origin: { kind: 'system', reasonKey: 'test' },
        kind: 'acquire_political_right',
        creatorPersonId: leaderId,
        supervisorPersonId: leaderId,
        status: 'completed',
        terminalReason: 'completed',
        progress: 100,
        targetProgress: 100,
        currentStageKey: 'execute_project',
        createdWeek: state.absoluteWeek,
        deadlineWeek: state.absoluteWeek + 48,
        reasonIds: [],
        polityId,
        target,
        budget: defaultConfig.acquirePoliticalRightBaseCost,
        spentBudget: 0,
      }
      const next: WorldState = {
        ...state,
        projects: { [projectId]: project },
        projectIndex: {
          byOwner: {},
          byAim: {},
          byParentProject: {},
          byCreatorPerson: {},
          bySupervisorPerson: {},
          byRelatedEntity: {},
        },
      }
      addProjectToIndexMut(next, project)
      return { state: next }
    })()

    const result = runProjectOutcomeSystem(makeCtx(ws))
    // 既存 right のみが残り、新しい right は作られない。cost も動かない
    expect(Object.keys(result.state.politicalRights)).toHaveLength(1)
    expect(result.state.houses[houseId]!.wealth).toBe(200)
    expect(result.events.some((e) => e.type === 'POLITICAL_RIGHT_GRANTED')).toBe(false)
  })
})

describe('acquire_political_right aim generation gate (§13.3)', () => {
  function makeGoal(): Goal {
    return {
      id: createGoalId(0),
      owner: { kind: 'house', id: houseId },
      kind: 'expand_power_base',
      status: 'active',
      createdWeek: 0,
      deadlineWeek: 480,
      reasonIds: [],
    } as unknown as Goal
  }

  it('generates the aim when influence >= gate and dedupes via aimSlotKey', () => {
    const state = makeState() // 唯一の landed house → influence ≈ 100%
    // 上限ゲート (default 70) に掛かる fixture なので、下限ゲートの検証用に上限を解除する
    const config: SimulationConfig = {
      ...defaultConfig,
      acquirePoliticalRightMaxInfluencePercent: 1000,
    }
    // pickHouseAim は重み付き抽選のため、競合する steer slot を除外して決定化する
    const steerSlot = aimSlotKey('steer_polity_external_expansion', {
      kind: 'polity',
      id: polityId,
    })
    const picked = pickAimForGoal(state, config, makeGoal(), createRng('t'), new Set([steerSlot]))
    expect(picked?.kind).toBe('acquire_political_right')
    expect(picked?.target?.kind).toBe('political_right_target')

    // 同一 target slot を excluded にすると別候補に落ちる (重複防止)
    const slot = aimSlotKey('acquire_political_right', picked!.target)
    const second = pickAimForGoal(
      state,
      config,
      makeGoal(),
      createRng('t'),
      new Set([slot, steerSlot]),
    )
    if (second?.kind === 'acquire_political_right') {
      expect(aimSlotKey('acquire_political_right', second.target)).not.toBe(slot)
    }
  })

  it('does not generate the aim when influence is below the gate', () => {
    const state = makeState()
    const config: SimulationConfig = {
      ...defaultConfig,
      acquirePoliticalRightRequiredInfluencePercent: 200, // 到達不能ゲート
      acquirePoliticalRightMaxInfluencePercent: 1000,
    }
    const picked = pickAimForGoal(state, config, makeGoal(), createRng('t'))
    expect(picked?.kind).not.toBe('acquire_political_right')
  })

  it('does not generate the aim for a fully-dominant owner (upper gate, default config)', () => {
    const state = makeState() // 唯一の landed house → influence ≈ 100% ≥ 70
    const picked = pickAimForGoal(state, defaultConfig, makeGoal(), createRng('t'))
    // acquire は上限ゲートで消え、steer のみが候補に残る
    expect(picked?.kind).toBe('steer_polity_external_expansion')
  })
})

// --- 非 owner 開放: 候補 polity 列挙 ---
// 正しさの条件は「influence breakdown が家を entry に導入する全 source の被覆」。
// source ごとに 1 polity を用意し、列挙が全部拾うこと・除外条件 (inactive faction /
// 死亡 member) が効くことを直接 pin する。

describe('collectAcquireRightCandidatePolityIds (acquire 開放)', () => {
  const suzerainId = createPolityId('dp', 20)
  const vassalPolityId = createPolityId('dp', 21)
  const officePolityId = createPolityId('dp', 22)
  const bailiffPolityId = createPolityId('dp', 23)
  const factionPolityId = createPolityId('dp', 24)
  const inactiveFactionPolityId = createPolityId('dp', 25)
  const rightPolityId = createPolityId('dp', 26)
  const deadMemberPolityId = createPolityId('dp', 27)

  const royalHouseId = createHouseId('dh', 20)
  const vassalHouseId = createHouseId('dh', 21)
  const otherHouseId = createHouseId('dh', 22)

  const vassalLeaderId = createPersonId('pe', 20)
  const vassalMember2Id = createPersonId('pe', 21)
  const deadMemberId = createPersonId('pe', 22)

  const suzerainProvinceId = createProvinceId('p', 20)
  const vassalProvinceId = createProvinceId('p', 21)
  const bailiffProvinceId = createProvinceId('p', 22)
  const bailiffHoldingId = createHoldingId(22)

  // 宗主 S (royalHouse 所有) と臣下 V (vassalHouse 所有) を contract chain で接続した状態
  function makeVassalState(): WorldState {
    let state = makeEmptyV016State()
    state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    state = withProvince(state, suzerainProvinceId, { nameKey: 'SuzerainProvince' })
    state = withProvince(state, vassalProvinceId, { nameKey: 'VassalProvince' })
    state = withHouse(state, royalHouseId, { seatProvinceId: suzerainProvinceId, wealth: 200 })
    state = withHouse(state, vassalHouseId, { seatProvinceId: vassalProvinceId, wealth: 200 })
    state = withPerson(state, createPersonId('pe', 29), { houseId: royalHouseId })
    state = withPerson(state, vassalLeaderId, { houseId: vassalHouseId })
    state = withPolity(state, suzerainId, {
      ownerHouseId: royalHouseId,
      rank: 3,
      capitalProvinceId: suzerainProvinceId,
    })
    state = withPolity(state, vassalPolityId, {
      ownerHouseId: vassalHouseId,
      capitalProvinceId: vassalProvinceId,
    })
    state = bindProvinceToHouseViaPolity(state, suzerainProvinceId, suzerainId, royalHouseId)
    // vassalProvince は root contract を S に張り、その下に V の child contract をぶら下げる
    // (宗主チェーン: V の contract の parentContractId → S の contract)
    state = bindProvinceToPolity(state, vassalProvinceId, suzerainId)
    const rootContractId = (state.landContractIndex.byGranteePolity[suzerainId] ?? []).find(
      (cid) => state.landContracts[cid]?.provinceId === vassalProvinceId,
    )
    if (!rootContractId) throw new Error('fixture: root contract not found')
    const rootContract = state.landContracts[rootContractId]!
    const child = createChildLandContract(state, {
      provinceId: vassalProvinceId,
      parentContractId: rootContractId,
      granteePolityId: vassalPolityId,
      taxRateToGrantor: 0.1,
      ...(rootContract.holdingId !== undefined ? { holdingId: rootContract.holdingId } : {}),
    })
    return child.state
  }

  it('covers all influence sources and applies the exclusion filters', () => {
    let state = makeVassalState()

    // source ②③: 生存 member が polity office を持つ polity
    state = withPolity(state, officePolityId, { capitalProvinceId: suzerainProvinceId })
    state = withPerson(state, vassalMember2Id, { houseId: vassalHouseId })
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: officePolityId },
      'treasurer',
      vassalMember2Id,
    )

    // source ⑤: 生存 member が bailiff を務める holding の terminal polity
    state = withProvince(state, bailiffProvinceId, { nameKey: 'BailiffProvince' })
    state = withHolding(state, bailiffHoldingId, bailiffProvinceId)
    state = withHouse(state, otherHouseId, { seatProvinceId: bailiffProvinceId })
    state = withPolity(state, bailiffPolityId, { capitalProvinceId: bailiffProvinceId })
    state = bindProvinceToHouseViaPolity(state, bailiffProvinceId, bailiffPolityId, otherHouseId)
    const bailiffOfficeId = createHoldingOfficeAssignmentId(0)
    const bailiffOffice: HoldingOfficeAssignment = {
      id: bailiffOfficeId,
      holdingId: bailiffHoldingId,
      role: 'bailiff',
      holderPersonId: vassalMember2Id,
      appointingPolityId: bailiffPolityId,
      active: true,
      startWeek: 0,
      unpaidCount: 0,
      contractedRemittanceRate: 0.5,
      expectedFeeRate: 0.1,
    }
    state = {
      ...state,
      holdingOfficeAssignments: {
        ...state.holdingOfficeAssignments,
        [bailiffOfficeId]: bailiffOffice,
      },
      holdingOfficeIndex: {
        ...state.holdingOfficeIndex,
        byHolding: { ...state.holdingOfficeIndex.byHolding, [bailiffHoldingId]: bailiffOfficeId },
        byHolderPerson: {
          ...state.holdingOfficeIndex.byHolderPerson,
          [vassalMember2Id]: [bailiffOfficeId],
        },
        byAppointingPolity: {
          ...state.holdingOfficeIndex.byAppointingPolity,
          [bailiffPolityId]: [bailiffOfficeId],
        },
      },
    }

    // source ⑥: 生存 member が leader の active Faction の anchor polity。
    // inactive Faction の anchor は除外されること
    state = withPolity(state, factionPolityId, { capitalProvinceId: suzerainProvinceId })
    state = withPolity(state, inactiveFactionPolityId, { capitalProvinceId: suzerainProvinceId })
    const activeFactionId = createFactionId(0)
    const inactiveFactionId = createFactionId(1)
    const activeFaction: Faction = {
      id: activeFactionId,
      leaderPersonId: vassalLeaderId,
      polityId: factionPolityId,
      active: true,
      foundingWeek: 0,
    }
    const inactiveFaction: Faction = {
      id: inactiveFactionId,
      leaderPersonId: vassalLeaderId,
      polityId: inactiveFactionPolityId,
      active: false,
      foundingWeek: 0,
    }
    state = {
      ...state,
      factions: {
        ...state.factions,
        [activeFactionId]: activeFaction,
        [inactiveFactionId]: inactiveFaction,
      },
      factionIndex: {
        ...state.factionIndex,
        byLeader: {
          ...state.factionIndex.byLeader,
          [vassalLeaderId]: [activeFactionId, inactiveFactionId],
        },
        byPolity: {
          ...state.factionIndex.byPolity,
          [factionPolityId]: [activeFactionId],
          [inactiveFactionPolityId]: [inactiveFactionId],
        },
      },
    }

    // source ④: 家が既に right を保有する polity
    state = withPolity(state, rightPolityId, { capitalProvinceId: suzerainProvinceId })
    const granted = createPoliticalRight(state, {
      polityId: rightPolityId,
      target: {
        kind: 'polity_office_role',
        polityId: rightPolityId,
        role: 'administrator',
        slotIndex: 0,
      },
      holder: { kind: 'house', id: vassalHouseId },
      grantedWeek: 0,
    })
    if (!granted.ok) throw new Error('fixture: right grant failed')
    state = granted.value.state

    // 除外: 死亡 member の office しか接点が無い polity は含まれない
    state = withPolity(state, deadMemberPolityId, { capitalProvinceId: suzerainProvinceId })
    state = withPerson(state, deadMemberId, { houseId: vassalHouseId })
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: deadMemberPolityId },
      'treasurer',
      deadMemberId,
    )
    const deadMember = state.persons[deadMemberId]!
    state = {
      ...state,
      persons: { ...state.persons, [deadMemberId]: { ...deadMember, alive: false } },
    }

    const owned = getHouseOwnedPolityIds(state, vassalHouseId)
    const ids = collectAcquireRightCandidatePolityIds(state, vassalHouseId, owned).map(
      (id) => id as string,
    )

    expect(ids).toContain(vassalPolityId) // owned
    expect(ids).toContain(suzerainId) // 宗主チェーン
    expect(ids).toContain(officePolityId) // member polity office
    expect(ids).toContain(bailiffPolityId) // member bailiff
    expect(ids).toContain(factionPolityId) // active faction leader
    expect(ids).toContain(rightPolityId) // 既保有 right
    expect(ids).not.toContain(inactiveFactionPolityId) // inactive faction は除外
    expect(ids).not.toContain(deadMemberPolityId) // 死亡 member は除外
    // 決定的順序 (昇順ソート)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('vassal house skips its dominated own polity and targets the suzerain (integration)', () => {
    const state = makeVassalState()
    // vassalHouse は V で influence ≈ 100% (唯一の家) → 上限 70 で gated。
    // S では royalHouse と分け合うため帯に入る (下限は 1 に緩和して確実化)
    const config: SimulationConfig = {
      ...defaultConfig,
      acquirePoliticalRightRequiredInfluencePercent: 1,
    }
    const goal = {
      id: createGoalId(1),
      owner: { kind: 'house', id: vassalHouseId },
      kind: 'expand_power_base',
      status: 'active',
      createdWeek: 0,
      deadlineWeek: 480,
      reasonIds: [],
    } as unknown as Goal
    // steer (owned polity = V のみ) を除外して acquire を決定化
    const steerSlot = aimSlotKey('steer_polity_external_expansion', {
      kind: 'polity',
      id: vassalPolityId,
    })
    const picked = pickAimForGoal(state, config, goal, createRng('t'), new Set([steerSlot]))
    expect(picked?.kind).toBe('acquire_political_right')
    const target = picked!.target as Extract<EntityRef, { kind: 'political_right_target' }>
    expect(target.kind).toBe('political_right_target')
    if (target.target.kind !== 'polity_office_role') throw new Error('expected office target')
    expect(target.target.polityId).toBe(suzerainId)
  })
})

// --- 非 owner 開放: political_right_target aim の枝刈り (isTargetValid) ---

describe('political_right_target aim invalidation', () => {
  const aimId = createAimId(0)

  function withAcquireAim(
    state: WorldState,
    owner: HouseId,
    target: PoliticalRightTargetRef,
  ): WorldState {
    return withAim(state, aimId, { kind: 'house', id: owner }, 'acquire_political_right', {
      target: { kind: 'political_right_target', target },
    })
  }

  it('fails the aim when another house already holds the right (race lost)', () => {
    let state = makeState()
    const target = findAcquirableRightTarget(state, defaultConfig, houseId, polityId)!
    const rivalHouseId = createHouseId('dh', 9)
    state = withHouse(state, rivalHouseId, { seatProvinceId: provinceId })
    const granted = createPoliticalRight(state, {
      polityId,
      target,
      holder: { kind: 'house', id: rivalHouseId },
      grantedWeek: state.absoluteWeek,
    })
    if (!granted.ok) throw new Error('setup failed')
    state = withAcquireAim(granted.value.state, houseId, target)

    const result = runAimMaintenanceSystem(makeCtx(state))
    expect(result.state.aims[aimId]?.status).toBe('failed')
    expect(result.events.some((e) => e.type === 'AIM_FAILED')).toBe(true)
  })

  it('keeps the aim when the house itself holds the right', () => {
    let state = makeState()
    const target = findAcquirableRightTarget(state, defaultConfig, houseId, polityId)!
    const granted = createPoliticalRight(state, {
      polityId,
      target,
      holder: { kind: 'house', id: houseId },
      grantedWeek: state.absoluteWeek,
    })
    if (!granted.ok) throw new Error('setup failed')
    state = withAcquireAim(granted.value.state, houseId, target)

    const result = runAimMaintenanceSystem(makeCtx(state))
    expect(result.state.aims[aimId]?.status).toBe('active')
  })

  it('fails office-target aims whose slot exceeded effectiveMax', () => {
    let state = makeState()
    // fixture の小規模 polity では administrator の effectiveMax < 静的 max (3) のはず。
    // effectiveMax 以上の slot を狙う aim は枝刈りされる
    const effectiveMax = getEffectiveOfficeMaxHolders(
      state,
      defaultConfig,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    expect(effectiveMax).toBeLessThan(3)
    const target: PoliticalRightTargetRef = {
      kind: 'polity_office_role',
      polityId,
      role: 'administrator',
      slotIndex: effectiveMax,
    }
    state = withAcquireAim(state, houseId, target)
    const result = runAimMaintenanceSystem(makeCtx(state))
    expect(result.state.aims[aimId]?.status).toBe('failed')
  })

  it('keeps office-target aims within effectiveMax and without an existing right', () => {
    let state = makeState()
    const target = findAcquirableRightTarget(state, defaultConfig, houseId, polityId)!
    state = withAcquireAim(state, houseId, target)
    const result = runAimMaintenanceSystem(makeCtx(state))
    expect(result.state.aims[aimId]?.status).toBe('active')
  })
})
