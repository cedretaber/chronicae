import { describe, it, expect } from 'vitest'
import { runFacilityMaintenanceSystem } from './facilityMaintenanceSystem'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import {
  makeEmptyV016State,
  withPolity,
  withHouse,
  withPerson,
  withProvince,
  withHolding,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import { createCrisisMut, setCrisisResponseProjectMut } from '../mutations/crisisMutations'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import type { HandleCrisisProject, DevelopHoldingProject } from '../types/project'
import type { HoldingImprovement } from '../types/holdingImprovement'
import type {
  HoldingId,
  PolityId,
  HouseId,
  PersonId,
  ProvinceId,
  ProjectId,
  HoldingImprovementId,
} from '../types/ids'
import type { WorldState } from '../types/world'

const PROVINCE = 'pr-1' as ProvinceId
const HOLDING = 'hl-0' as HoldingId
const POLITY = 'c-1' as PolityId
const HOUSE = 'h-1' as HouseId
const LEADER = 'p-sv' as PersonId
const IMP = 'hi-0' as HoldingImprovementId

// province → polity → house → leader を結び、getHoldingTerminalPolityId が active owner を解決できる
// bound な世界を作る。holding hl-0 に improvement hi-0 (level/condition は呼び出し側指定) を置く。
function makeBoundWorld(impOverrides: Partial<HoldingImprovement> = {}): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  s = withPolity(s, POLITY, { treasury: 500, capitalProvinceId: PROVINCE })
  s = withHouse(s, HOUSE, { seatProvinceId: PROVINCE })
  s = withPerson(s, LEADER, { houseId: HOUSE })
  s = bindProvinceToHouseViaPolity(s, PROVINCE, POLITY, HOUSE)
  s = withHolding(s, HOLDING, PROVINCE)

  const imp: HoldingImprovement = {
    id: IMP,
    holdingId: HOLDING,
    kind: 'field_system',
    level: 2,
    condition: 100,
    createdWeek: 0,
    ...impOverrides,
  }
  s = {
    ...s,
    holdingImprovements: { ...s.holdingImprovements, [IMP]: imp },
    holdingImprovementIndex: {
      byHolding: { ...s.holdingImprovementIndex.byHolding, [HOLDING as string]: [IMP] },
    },
  }
  return s
}

describe('facilityMaintenanceSystem 減衰 (§2.1)', () => {
  it('condition が decayPerCyclePerLevel × level だけ減る', () => {
    const s = makeBoundWorld({ condition: 100, level: 2 })
    const ctx = createTickContext({ state: s, rng: createRng('decay'), config: defaultConfig })
    const next = runFacilityMaintenanceSystem(ctx)
    // 0.9 × 2 = 1.8 → 100 - 1.8 = 98.2
    expect(next.state.holdingImprovements[IMP]?.condition).toBeCloseTo(98.2)
  })

  it('元 state の improvement オブジェクトは変化しない (per-object spread / cross-tick 非汚染)', () => {
    const s = makeBoundWorld({ condition: 100, level: 2 })
    const ctx = createTickContext({ state: s, rng: createRng('decay'), config: defaultConfig })
    runFacilityMaintenanceSystem(ctx)
    expect(s.holdingImprovements[IMP]?.condition).toBe(100)
  })
})

describe('facilityMaintenanceSystem 閾値割れ → disrepair Crisis 発火 (§2.2)', () => {
  it('threshold 未満の improvement に disrepair Crisis を spawn する (targetImprovementId 込み)', () => {
    // condition 40 (threshold 50 未満)。減衰後も 40 - 1.8 = 38.2 で閾値未満。
    const s = makeBoundWorld({ condition: 40, level: 2 })
    const ctx = createTickContext({ state: s, rng: createRng('spawn'), config: defaultConfig })
    const next = runFacilityMaintenanceSystem(ctx)

    const crises = Object.values(next.state.crises)
    const disrepair = crises.filter((c) => c?.kind === 'disrepair')
    expect(disrepair).toHaveLength(1)
    expect(disrepair[0]?.targetImprovementId).toBe(IMP)
    expect(disrepair[0]?.holdingId).toBe(HOLDING)
    // severity は spawn 時 = 修理工数 (crisisInitialSeverityByKind.disrepair)
    expect(disrepair[0]?.severity).toBe(defaultConfig.crisisInitialSeverityByKind.disrepair)
  })

  it('同 improvement の active disrepair Crisis があれば再 spawn しない (dedup)', () => {
    const s = makeBoundWorld({ condition: 40, level: 2 })
    const ctx1 = createTickContext({ state: s, rng: createRng('dedup'), config: defaultConfig })
    const after1 = runFacilityMaintenanceSystem(ctx1)
    const ctx2 = createTickContext({
      state: after1.state,
      rng: createRng('dedup'),
      config: defaultConfig,
    })
    const after2 = runFacilityMaintenanceSystem(ctx2)

    const disrepair = Object.values(after2.state.crises).filter((c) => c?.kind === 'disrepair')
    expect(disrepair).toHaveLength(1)
  })
})

describe('facilityMaintenanceSystem 破壊 (§2.3)', () => {
  it('condition 0 到達 + level 2 → level 1 + condition 回復 (部分崩壊)', () => {
    // condition 1 で減衰 (0.9×2=1.8) → max(0, 1-1.8)=0 → 破壊
    const s = makeBoundWorld({ condition: 1, level: 2 })
    const ctx = createTickContext({ state: s, rng: createRng('degrade'), config: defaultConfig })
    const next = runFacilityMaintenanceSystem(ctx)

    const imp = next.state.holdingImprovements[IMP]
    expect(imp?.level).toBe(1)
    expect(imp?.condition).toBe(defaultConfig.facilityRepairConditionRestore)
    const breakdown = next.events.filter((e) => e.type === 'FACILITY_BREAKDOWN')
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0]?.messageParams?.breakdownOutcome).toBe('degraded')
  })

  it('condition 0 到達 + level 1 → improvement 削除 + index から除去 (全壊)', () => {
    // level 1 の減衰は 0.9×1=0.9。condition 0.5 → max(0, 0.5-0.9)=0 → 全壊
    const s = makeBoundWorld({ condition: 0.5, level: 1 })
    const ctx = createTickContext({ state: s, rng: createRng('destroy'), config: defaultConfig })
    const next = runFacilityMaintenanceSystem(ctx)

    expect(next.state.holdingImprovements[IMP]).toBeUndefined()
    // 空配列なら key ごと delete
    expect(next.state.holdingImprovementIndex.byHolding[HOLDING as string]).toBeUndefined()
    const breakdown = next.events.filter((e) => e.type === 'FACILITY_BREAKDOWN')
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0]?.messageParams?.breakdownOutcome).toBe('destroyed')
  })

  it('破壊時に active disrepair Crisis を purge し修理 Project を cancel する', () => {
    const s = makeBoundWorld({ condition: 0.5, level: 1 })
    // 先に disrepair Crisis + 修理 Project を張る
    const crisis = createCrisisMut(s, {
      kind: 'disrepair',
      holdingId: HOLDING,
      severity: 30,
      createdWeek: 0,
      deadlineWeek: 999,
      status: 'active',
      reasonIds: [],
      targetImprovementId: IMP,
    })
    const projectId = 'pr-9' as ProjectId
    const project: HandleCrisisProject = {
      id: projectId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'crisis_response' },
      kind: 'handle_crisis',
      crisisId: crisis.id,
      holdingId: HOLDING,
      creatorPersonId: LEADER,
      supervisorPersonId: LEADER,
      status: 'active',
      progress: 5,
      targetProgress: 30,
      currentStageKey: 'mitigate',
      createdWeek: 0,
      reasonIds: [],
      budget: { required: 20, allocated: 20, remaining: 12, spent: 8, source: { kind: 'owner' } },
    }
    s.projects[projectId] = project
    addProjectToIndexMut(s, project)
    setCrisisResponseProjectMut(s, crisis.id, projectId)

    const ctx = createTickContext({ state: s, rng: createRng('purge'), config: defaultConfig })
    const next = runFacilityMaintenanceSystem(ctx)

    expect(next.state.crises[crisis.id]).toBeUndefined()
    const p = next.state.projects[projectId]
    expect(p?.status).toBe('cancelled')
    expect(p?.terminalReason).toBe('target_destroyed')
  })
})

describe('修理完了 → condition 回復 (§4.2, projectOutcomeSystem)', () => {
  it('completed handle_crisis(disrepair) Project → improvement condition 回復 + Crisis purge', () => {
    const s = makeBoundWorld({ condition: 10, level: 2 })
    const crisis = createCrisisMut(s, {
      kind: 'disrepair',
      holdingId: HOLDING,
      severity: 30,
      createdWeek: 0,
      deadlineWeek: 999,
      status: 'active',
      reasonIds: [],
      targetImprovementId: IMP,
    })
    const projectId = 'pr-9' as ProjectId
    const project: HandleCrisisProject = {
      id: projectId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'crisis_response' },
      kind: 'handle_crisis',
      crisisId: crisis.id,
      holdingId: HOLDING,
      creatorPersonId: LEADER,
      supervisorPersonId: LEADER,
      status: 'completed',
      terminalReason: 'completed',
      progress: 30,
      targetProgress: 30,
      currentStageKey: 'mitigate',
      createdWeek: 0,
      reasonIds: [],
      budget: { required: 20, allocated: 20, remaining: 20, spent: 0, source: { kind: 'owner' } },
    }
    s.projects[projectId] = project
    addProjectToIndexMut(s, project)
    setCrisisResponseProjectMut(s, crisis.id, projectId)

    const ctx = createTickContext({ state: s, rng: createRng('repair'), config: defaultConfig })
    const next = runProjectOutcomeSystem(ctx)

    expect(next.state.holdingImprovements[IMP]?.condition).toBe(
      defaultConfig.facilityRepairConditionRestore,
    )
    expect(next.state.crises[crisis.id]).toBeUndefined()
  })
})

describe('develop_holding 完了で condition リセット + disrepair Crisis 解消', () => {
  it('既存設備の develop 完了 → condition 100 回復 / active disrepair Crisis purge / 修理 Project cancel', () => {
    const s = makeBoundWorld({ condition: 20, level: 2 })
    // 機能不全中の設備に disrepair Crisis + 修理 Project がぶら下がっている状況
    const crisis = createCrisisMut(s, {
      kind: 'disrepair',
      holdingId: HOLDING,
      severity: 30,
      createdWeek: 0,
      deadlineWeek: 999,
      status: 'active',
      reasonIds: [],
      targetImprovementId: IMP,
    })
    const repairId = 'pr-repair' as ProjectId
    const repair: HandleCrisisProject = {
      id: repairId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'crisis_response' },
      kind: 'handle_crisis',
      crisisId: crisis.id,
      holdingId: HOLDING,
      creatorPersonId: LEADER,
      supervisorPersonId: LEADER,
      status: 'active',
      progress: 5,
      targetProgress: 30,
      currentStageKey: 'mitigate',
      createdWeek: 0,
      reasonIds: [],
      budget: { required: 20, allocated: 20, remaining: 12, spent: 8, source: { kind: 'owner' } },
    }
    s.projects[repairId] = repair
    addProjectToIndexMut(s, repair)
    setCrisisResponseProjectMut(s, crisis.id, repairId)

    // 同 holding/improvement を対象とする completed develop_holding Project
    const devId = 'pr-dev' as ProjectId
    const dev: DevelopHoldingProject = {
      id: devId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'develop_holding',
      creatorPersonId: LEADER,
      supervisorPersonId: LEADER,
      status: 'completed',
      terminalReason: 'completed',
      progress: 100,
      targetProgress: 100,
      currentStageKey: 'execute_project',
      createdWeek: 0,
      reasonIds: [],
      holdingId: HOLDING,
      improvementKind: 'field_system',
      targetImprovementLevel: 3,
      budget: { required: 10, allocated: 10, remaining: 10, spent: 0, source: { kind: 'owner' } },
    }
    s.projects[devId] = dev
    addProjectToIndexMut(s, dev)

    const ctx = createTickContext({ state: s, rng: createRng('dev'), config: defaultConfig })
    const next = runProjectOutcomeSystem(ctx)

    const imp = next.state.holdingImprovements[IMP]
    expect(imp?.level).toBe(3)
    expect(imp?.condition).toBe(defaultConfig.facilityRepairConditionRestore)
    expect(next.state.crises[crisis.id]).toBeUndefined()
    const p = next.state.projects[repairId]
    expect(p?.status).toBe('cancelled')
    expect(p?.terminalReason).toBe('target_repaired')
  })
})
