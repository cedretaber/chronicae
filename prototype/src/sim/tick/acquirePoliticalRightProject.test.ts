// v0.42 §13 acquire_political_right のユニットテスト (spec §20.1)。
// - project completion で PoliticalRight が作成される
// - cost が owner House wealth から対象 Polity treasury へ移転する (§13.4)
// - 既存 right がある target には作成しない
// - influence ゲート未満の House では Aim が生成されない (§13.3)

import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
  createProjectId,
  createGoalId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Goal } from '../types/goal'
import type { AcquirePoliticalRightProject } from '../types/project'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { pickAimForGoal, aimSlotKey } from '../selectors/goalSelectors'
import { findAcquirableRightTarget } from '../selectors/politicalRightSelectors'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
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
  const target = findAcquirableRightTarget(state, houseId, polityId)
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
    const target = findAcquirableRightTarget(base, houseId, polityId)!
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
    // pickHouseAim は重み付き抽選のため、競合する steer slot を除外して決定化する
    const steerSlot = aimSlotKey('steer_polity_external_expansion', {
      kind: 'polity',
      id: polityId,
    })
    const picked = pickAimForGoal(
      state,
      defaultConfig,
      makeGoal(),
      createRng('t'),
      new Set([steerSlot]),
    )
    expect(picked?.kind).toBe('acquire_political_right')
    expect(picked?.target?.kind).toBe('political_right_target')

    // 同一 target slot を excluded にすると別候補に落ちる (重複防止)
    const slot = aimSlotKey('acquire_political_right', picked!.target)
    const second = pickAimForGoal(
      state,
      defaultConfig,
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
    }
    const picked = pickAimForGoal(state, config, makeGoal(), createRng('t'))
    expect(picked?.kind).not.toBe('acquire_political_right')
  })
})
