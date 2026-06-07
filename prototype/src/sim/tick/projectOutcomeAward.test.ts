// v0.44 §5: projectOutcomeSystem の成果経験・評判 hook のユニットテスト。
// - completed → 経験 + 正評判
// - failed + 本人帰責 reason → 経験 + 負評判 / 非帰責 reason → 経験のみ
// - cancelled → 進捗比例経験のみ・評判なし
// - 外交 Project は skip (Play 側で評価)
// - terminalReason 漏れは fail-fast throw

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createProjectId,
  createHoldingId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Project, DevelopHoldingProject, LandClaimProject } from '../types/project'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

const polityId = createPolityId('dp', 0)
const houseId = createHouseId('dh', 0)
const supervisorId = createPersonId('pe', 0)
const provinceId = createProvinceId('p', 0)

// 決定的にする: 経験 4 × weight(stewardship: numeracy .6 / learning .2 / insight .2) × 500/100
//   → numeracy +12 / learning +4 / insight +4 (全部整数 → RNG 不要)
const testConfig: SimulationConfig = {
  ...defaultConfig,
  experienceImmediateGrowthChancePerPoint: 500,
}

function makeState(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId, {})
  state = withHouse(state, houseId, { seatProvinceId: provinceId })
  state = withPerson(state, supervisorId, { houseId })
  state = withPolity(state, polityId, { ownerHouseId: houseId, capitalProvinceId: provinceId })
  // aptitude を上げて成長余地を作る
  const person = state.persons[supervisorId]!
  state = {
    ...state,
    persons: {
      ...state.persons,
      [supervisorId]: {
        ...person,
        abilities: { ...person.abilities, numeracy: 50, learning: 50, insight: 50 },
        aptitudes: { ...person.aptitudes, numeracy: 90, learning: 90, insight: 90 },
      },
    },
  }
  return state
}

function withProject(state: WorldState, project: Project): WorldState {
  const ws: WorldState = {
    ...state,
    projects: { ...state.projects, [project.id]: project },
    projectIndex: {
      byOwner: { ...state.projectIndex.byOwner },
      byAim: { ...state.projectIndex.byAim },
      byParentProject: { ...state.projectIndex.byParentProject },
      byCreatorPerson: { ...state.projectIndex.byCreatorPerson },
      bySupervisorPerson: { ...state.projectIndex.bySupervisorPerson },
      byRelatedEntity: { ...state.projectIndex.byRelatedEntity },
    },
  }
  addProjectToIndexMut(ws, project)
  return ws
}

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
    holdingId: createHoldingId(999), // 実在しない → develop 効果は no-op、award だけ検証
    improvementKind: 'irrigation_infrastructure',
    targetImprovementLevel: 1,
    budget: { required: 0, allocated: 0, remaining: 0, spent: 0, source: { kind: 'owner' } },
    ...overrides,
  }
}

function makeCtx(state: WorldState, config: SimulationConfig = testConfig): TickContext {
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

describe('projectOutcomeSystem award hook (§5)', () => {
  it('completed: supervisor が成長し正評判を得る', () => {
    const state = withProject(makeState(), makeDevelopProject({}))
    const result = runProjectOutcomeSystem(makeCtx(state))

    const person = result.state.persons[supervisorId]!
    expect(person.abilities.numeracy).toBe(62) // 50 + 4*0.6*5
    expect(person.abilities.learning).toBe(54)
    expect(person.abilities.insight).toBe(54)

    const reps = Object.values(result.state.personReputations)
    expect(reps).toHaveLength(1)
    expect(reps[0]).toMatchObject({
      personId: supervisorId,
      category: 'administration',
      baseScore: testConfig.personReputationProjectSuccessBase,
    })

    const types = result.events.map((e) => e.type)
    expect(types.filter((t) => t === 'PERSON_ABILITY_GREW')).toHaveLength(3)
    expect(types).toContain('PERSON_REPUTATION_GAINED')
    // project は削除済み
    expect(Object.keys(result.state.projects)).toHaveLength(0)
  })

  it('failed + deadline_expired: 経験 (中) + 負評判', () => {
    const state = withProject(
      makeState(),
      makeDevelopProject({ status: 'failed', terminalReason: 'deadline_expired', progress: 5 }),
    )
    const result = runProjectOutcomeSystem(makeCtx(state))

    const person = result.state.persons[supervisorId]!
    expect(person.abilities.numeracy).toBe(56) // 50 + 2*0.6*5

    const reps = Object.values(result.state.personReputations)
    expect(reps).toHaveLength(1)
    expect(reps[0]!.baseScore).toBe(testConfig.personReputationProjectFailureBase)
    expect(result.events.map((e) => e.type)).toContain('PERSON_REPUTATION_DAMAGED')
  })

  it('failed + budget_exhausted: 経験のみ・評判なし (§5.5)', () => {
    const state = withProject(
      makeState(),
      makeDevelopProject({ status: 'failed', terminalReason: 'budget_exhausted', progress: 5 }),
    )
    const result = runProjectOutcomeSystem(makeCtx(state))

    expect(result.state.persons[supervisorId]!.abilities.numeracy).toBe(56)
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
  })

  it('cancelled: 進捗比例経験のみ・評判なし', () => {
    // progress 5/10 → 経験 = 4 * 0.5 * 0.5 = 1.0 → numeracy +3 (1*0.6*5)
    const state = withProject(
      makeState(),
      makeDevelopProject({ status: 'cancelled', terminalReason: 'owner_inactive', progress: 5 }),
    )
    const result = runProjectOutcomeSystem(makeCtx(state))

    expect(result.state.persons[supervisorId]!.abilities.numeracy).toBe(53)
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
  })

  it('外交 Project は award しない (§5.2)', () => {
    const landClaim: LandClaimProject = {
      id: createProjectId(1),
      owner: { kind: 'polity', id: polityId },
      origin: { kind: 'system', reasonKey: 'test' },
      kind: 'acquire_land',
      creatorPersonId: supervisorId,
      supervisorPersonId: supervisorId,
      status: 'completed',
      // terminalReason を意図的に持たない (外交系は fail-fast 対象外であることも検証)
      progress: 10,
      targetProgress: 10,
      currentStageKey: 'execute_project',
      createdWeek: 0,
      reasonIds: [],
      preparation: 0,
      leverage: 0,
      commitment: 0,
    }
    const state = withProject(makeState(), landClaim)
    const result = runProjectOutcomeSystem(makeCtx(state))

    expect(result.state.persons[supervisorId]!.abilities.numeracy).toBe(50)
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
  })

  it('非外交 terminal Project の terminalReason 漏れは throw する (fail-fast §5.3)', () => {
    const project = makeDevelopProject({})
    delete (project as { terminalReason?: string }).terminalReason
    const state = withProject(makeState(), project)
    expect(() => runProjectOutcomeSystem(makeCtx(state))).toThrow(/without terminalReason/)
  })

  it('supervisor 死亡時は award しない (alive guard §13.3)', () => {
    let state = withProject(makeState(), makeDevelopProject({}))
    const person = state.persons[supervisorId]!
    state = { ...state, persons: { ...state.persons, [supervisorId]: { ...person, alive: false } } }
    const result = runProjectOutcomeSystem(makeCtx(state))

    expect(result.state.persons[supervisorId]!.abilities.numeracy).toBe(50)
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
    // project 自体は削除される
    expect(Object.keys(result.state.projects)).toHaveLength(0)
  })
})
