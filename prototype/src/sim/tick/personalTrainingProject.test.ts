// v0.44 §6 personal_training Project のユニットテスト。
// - 生成経路: improve_ability aim → projectPreparationSystem (allowlist) → prepare_project task
//   → handlePrepareProjectCompletionMut → personal_training project (本人 3 役一致)
// - completed → 単一能力成長・評判ゼロ (§6.8)
// - 本人死亡 (処刑 cascade) → cancelled (§6.9)

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createProvinceId,
  createProjectId,
  createAimId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { PersonalTrainingProject } from '../types/project'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { runProjectPreparationSystem } from './projectPreparationSystem'
import { handlePrepareProjectCompletionMut } from './taskProjectCompletion'
import {
  addProjectToIndexMut,
  aimKindToProjectKind,
  reassignProjectsOfDeadSupervisor,
} from '../mutations/projectMutations'
import { makeEmptyV016State, withPerson, withHouse, withProvince, withAim } from '../testFixtures'

const houseId = createHouseId('dh', 0)
const personId = createPersonId('pe', 0)
const provinceId = createProvinceId('p', 0)
const aimId = createAimId(0)

const testConfig: SimulationConfig = {
  ...defaultConfig,
  // 経験 4 × weight 1.0 × 100/100 = +4 (整数 → 決定的)
  experienceImmediateGrowthChancePerPoint: 100,
}

function makeState(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId, {})
  state = withHouse(state, houseId, { seatProvinceId: provinceId })
  state = withPerson(state, personId, { houseId })
  const person = state.persons[personId]!
  state = {
    ...state,
    persons: {
      ...state.persons,
      [personId]: {
        ...person,
        abilities: { ...person.abilities, valor: 40 },
        aptitudes: { ...person.aptitudes, valor: 80 },
      },
    },
  }
  return state
}

function withImproveAbilityAim(state: WorldState): WorldState {
  return withAim(state, aimId, { kind: 'person', id: personId }, 'improve_ability', {
    target: { kind: 'ability', ability: 'valor' },
    targetProgress: 3,
  })
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

function makeTrainingProject(overrides: Partial<PersonalTrainingProject>): PersonalTrainingProject {
  return {
    id: createProjectId(0),
    owner: { kind: 'person', id: personId },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'personal_training',
    creatorPersonId: personId,
    supervisorPersonId: personId,
    traineePersonId: personId,
    trainingAbilityKey: 'valor',
    status: 'active',
    progress: 0,
    targetProgress: 3,
    currentStageKey: 'execute_project',
    createdWeek: 0,
    reasonIds: [],
    ...overrides,
  }
}

function withProject(state: WorldState, project: PersonalTrainingProject): WorldState {
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

describe('personal_training 生成経路 (§6.5)', () => {
  it('aimKindToProjectKind が improve_ability → personal_training を返す', () => {
    expect(aimKindToProjectKind('improve_ability')).toBe('personal_training')
  })

  it('projectPreparationSystem が person-owned improve_ability aim に prepare_project task を発行する (allowlist)', () => {
    const state = withImproveAbilityAim(makeState())
    const result = runProjectPreparationSystem(makeCtx(state))

    const aim = result.state.aims[aimId]!
    expect(aim.activeTaskId).toBeDefined()
    const task = result.state.tasks[aim.activeTaskId!]!
    expect(task.kind).toBe('prepare_project')
    expect(task.assigneePersonId).toBe(personId)
  })

  it('person-owned の他 aim は引き続き除外される (allowlist)', () => {
    let state = makeState()
    state = withAim(state, aimId, { kind: 'person', id: personId }, 'accumulate_wealth', {})
    const result = runProjectPreparationSystem(makeCtx(state))
    expect(result.state.aims[aimId]!.activeTaskId).toBeUndefined()
  })

  it('prepare_project 完了で本人 3 役一致の personal_training project が生成される', () => {
    const base = withImproveAbilityAim(makeState())
    const ws: WorldState = {
      ...base,
      projects: { ...base.projects },
      projectIndex: {
        byOwner: { ...base.projectIndex.byOwner },
        byAim: { ...base.projectIndex.byAim },
        byParentProject: { ...base.projectIndex.byParentProject },
        byCreatorPerson: { ...base.projectIndex.byCreatorPerson },
        bySupervisorPerson: { ...base.projectIndex.bySupervisorPerson },
        byRelatedEntity: { ...base.projectIndex.byRelatedEntity },
      },
      aims: { ...base.aims },
      tasks: { ...base.tasks },
      taskIndex: {
        byAssignee: { ...base.taskIndex.byAssignee },
        byOwner: { ...base.taskIndex.byOwner },
        byTarget: { ...base.taskIndex.byTarget },
      },
    }
    const aim = ws.aims[aimId]!
    handlePrepareProjectCompletionMut(ws, testConfig, aim, personId, 100, () => {}, 'success')

    const projects = Object.values(ws.projects)
    expect(projects).toHaveLength(1)
    const project = projects[0]!
    expect(project.kind).toBe('personal_training')
    if (project.kind !== 'personal_training') return
    expect(project.owner).toEqual({ kind: 'person', id: personId })
    expect(project.creatorPersonId).toBe(personId)
    expect(project.supervisorPersonId).toBe(personId)
    expect(project.traineePersonId).toBe(personId)
    expect(project.trainingAbilityKey).toBe('valor')
    expect(project.targetProgress).toBe(testConfig.personalTrainingTargetProgress)
    expect(project.currentStageKey).toBe('execute_project')
    // deadline は personalTrainingDeadlineWeeks ベース (aim.deadlineWeek と min)
    expect(project.deadlineWeek).toBe(100 + testConfig.personalTrainingDeadlineWeeks)
  })
})

describe('personal_training terminal (§6.8-6.9)', () => {
  it('completed: trainingAbilityKey の単一能力のみ成長し評判は発生しない', () => {
    const state = withProject(
      makeState(),
      makeTrainingProject({ status: 'completed', terminalReason: 'completed', progress: 3 }),
    )
    const result = runProjectOutcomeSystem(makeCtx(state))

    const person = result.state.persons[personId]!
    expect(person.abilities.valor).toBe(44) // 40 + 4*1.0*1
    // 他能力は不変
    expect(person.abilities.numeracy).toBe(50)
    expect(person.abilities.insight).toBe(50)
    // 評判は一切発生しない (§6.8)
    expect(Object.keys(result.state.personReputations)).toHaveLength(0)
    expect(
      result.events.filter(
        (e) => e.type === 'PERSON_REPUTATION_GAINED' || e.type === 'PERSON_REPUTATION_DAMAGED',
      ),
    ).toHaveLength(0)
    const grew = result.events.filter((e) => e.type === 'PERSON_ABILITY_GREW')
    expect(grew).toHaveLength(1)
    expect(grew[0]!.messageParams).toMatchObject({ ability: 'valor', oldValue: 40, newValue: 44 })
  })

  it('本人死亡 (処刑 cascade): reassignProjectsOfDeadSupervisor で cancelled になる (§6.9)', () => {
    let state = withProject(makeState(), makeTrainingProject({}))
    const person = state.persons[personId]!
    state = { ...state, persons: { ...state.persons, [personId]: { ...person, alive: false } } }

    const result = reassignProjectsOfDeadSupervisor(makeCtx(state), personId)
    const project = result.state.projects[createProjectId(0)]!
    expect(project.status).toBe('cancelled')
    expect(project.terminalReason).toBe('owner_inactive')
  })
})
