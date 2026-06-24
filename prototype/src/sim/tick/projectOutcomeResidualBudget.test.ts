// v0.60.4: Project 終了時 (成功・失敗とも) の残予算 budget.remaining は担当者 (supervisor) 総取り。
//   担当者が死亡/不在なら owner へフォールバックし保存則を守る。
//   acquire_real_estate の成功時除外は projectOutcomeAcquireFunding.test.ts でカバー (seller=allocated)。

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createProjectId,
  createHoldingId,
  createRealEstateAssetId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type {
  DevelopHoldingProject,
  UpgradeOwnedRealEstateProject,
  AcquireRealEstateProject,
} from '../types/project'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

const polityId = createPolityId('rp', 0)
const houseId = createHouseId('rh', 0)
const supervisorId = createPersonId('rs', 0)
const provinceId = createProvinceId('rpr', 0)

function makeState(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId, {})
  state = withHouse(state, houseId, { seatProvinceId: provinceId })
  state = withPolity(state, polityId, { ownerHouseId: houseId, capitalProvinceId: provinceId })
  return state
}

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('residual'),
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

// holdingId=999 は実在しないので develop 効果は no-op。残予算還付だけを検証できる。
function makeDevelopProject(overrides: Partial<DevelopHoldingProject>): DevelopHoldingProject {
  return {
    id: createProjectId(0),
    owner: { kind: 'polity', id: polityId },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'develop_holding',
    creatorPersonId: supervisorId,
    supervisorPersonId: supervisorId,
    status: 'completed',
    terminalReason: 'completed',
    progress: 10,
    targetProgress: 10,
    currentStageKey: 'execute_project',
    createdWeek: 0,
    reasonIds: [],
    holdingId: createHoldingId(999),
    improvementKind: 'irrigation_infrastructure',
    targetImprovementLevel: 1,
    budget: { required: 100, allocated: 100, remaining: 50, spent: 50, source: { kind: 'owner' } },
    ...overrides,
  }
}

function withProject(state: WorldState, project: DevelopHoldingProject): WorldState {
  const ws: WorldState = { ...state, projects: { ...state.projects, [project.id]: project } }
  addProjectToIndexMut(ws, project)
  return ws
}

describe('v0.60.4 Project 残予算は担当者 (supervisor) 総取り', () => {
  it('成功時: 残予算は担当者の wealth へ (owner ではない)', () => {
    let s = makeState()
    s = withPerson(s, supervisorId, { houseId, wealth: 0 })
    s = withProject(s, makeDevelopProject({ status: 'completed', terminalReason: 'completed' }))
    const treasuryBefore = s.polities[polityId]!.treasury

    const next = runProjectOutcomeSystem(makeCtx(s))

    expect(next.state.persons[supervisorId]?.wealth).toBe(50)
    expect(next.state.polities[polityId]?.treasury).toBe(treasuryBefore)
  })

  it('失敗時: 残予算も担当者の wealth へ (旧仕様は owner 還付)', () => {
    let s = makeState()
    s = withPerson(s, supervisorId, { houseId, wealth: 0 })
    s = withProject(s, makeDevelopProject({ status: 'failed', terminalReason: 'deadline_expired' }))
    const treasuryBefore = s.polities[polityId]!.treasury

    const next = runProjectOutcomeSystem(makeCtx(s))

    expect(next.state.persons[supervisorId]?.wealth).toBe(50)
    expect(next.state.polities[polityId]?.treasury).toBe(treasuryBefore)
  })

  it('担当者が死亡なら owner (polity treasury) へフォールバック', () => {
    let s = makeState()
    s = withPerson(s, supervisorId, { houseId, wealth: 0, alive: false })
    s = withProject(s, makeDevelopProject({ status: 'completed', terminalReason: 'completed' }))
    const treasuryBefore = s.polities[polityId]!.treasury

    const next = runProjectOutcomeSystem(makeCtx(s))

    // 死亡担当者には積まれず owner polity の treasury に還付される (保存則維持)
    expect(next.state.persons[supervisorId]?.wealth).toBe(0)
    expect(next.state.polities[polityId]?.treasury).toBe(treasuryBefore + 50)
  })

  it('担当者死亡 + owner が house なら house.wealth へフォールバック', () => {
    let s = makeState()
    s = withPerson(s, supervisorId, { houseId, wealth: 0, alive: false })
    s = withProject(
      s,
      makeDevelopProject({
        owner: { kind: 'house', id: houseId },
        status: 'completed',
        terminalReason: 'completed',
      }),
    )
    const wealthBefore = s.houses[houseId]!.wealth

    const next = runProjectOutcomeSystem(makeCtx(s))

    expect(next.state.persons[supervisorId]?.wealth).toBe(0)
    expect(next.state.houses[houseId]?.wealth).toBe(wealthBefore + 50)
  })

  it('upgrade_owned_real_estate 成功: 還付先が旧 owner house から担当者へ反転 (v0.60.4)', () => {
    let s = makeState()
    s = withPerson(s, supervisorId, { houseId, wealth: 0 })
    // asset は実在させない → upgrade 効果は no-op、中央集約の残予算還付だけを検証
    const project: UpgradeOwnedRealEstateProject = {
      id: createProjectId(0),
      owner: { kind: 'house', id: houseId },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'upgrade_owned_real_estate',
      creatorPersonId: supervisorId,
      supervisorPersonId: supervisorId,
      status: 'completed',
      terminalReason: 'completed',
      progress: 10,
      targetProgress: 10,
      currentStageKey: 'execute_project',
      createdWeek: 0,
      reasonIds: [],
      holdingId: createHoldingId(999),
      targetRealEstateAssetId: createRealEstateAssetId(999),
      realEstateKind: 'farm',
      targetRealEstateLevel: 2,
      budget: {
        required: 100,
        allocated: 100,
        remaining: 40,
        spent: 60,
        source: { kind: 'owner' },
      },
    }
    const ws: WorldState = { ...s, projects: { ...s.projects, [project.id]: project } }
    addProjectToIndexMut(ws, project)
    const wealthBefore = ws.houses[houseId]!.wealth

    const next = runProjectOutcomeSystem(makeCtx(ws))

    expect(next.state.persons[supervisorId]?.wealth).toBe(40)
    expect(next.state.houses[houseId]?.wealth).toBe(wealthBefore) // 旧仕様の owner house ではない
  })

  it('acquire_real_estate 失敗: 集めた残予算は担当者へ (売り手未払い・保存則維持)', () => {
    let s = makeState()
    s = withPerson(s, supervisorId, { houseId, wealth: 0 })
    const project: AcquireRealEstateProject = {
      id: createProjectId(0),
      owner: { kind: 'house', id: houseId },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'acquire_real_estate',
      creatorPersonId: supervisorId,
      supervisorPersonId: supervisorId,
      status: 'failed',
      terminalReason: 'funding_failed',
      progress: 0,
      targetProgress: 10,
      currentStageKey: 'execute_project',
      createdWeek: 0,
      reasonIds: [],
      holdingId: createHoldingId(999),
      targetRealEstateAssetId: createRealEstateAssetId(999),
      salePrice: 100,
      budget: { required: 100, allocated: 60, remaining: 60, spent: 0, source: { kind: 'owner' } },
    }
    const ws: WorldState = { ...s, projects: { ...s.projects, [project.id]: project } }
    addProjectToIndexMut(ws, project)

    const next = runProjectOutcomeSystem(makeCtx(ws))

    expect(next.state.persons[supervisorId]?.wealth).toBe(60)
  })
})
