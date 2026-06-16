import { describe, it, expect } from 'vitest'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { runCrisisSystem } from './crisisSystem'
import {
  makeEmptyV016State,
  withPolity,
  withHouse,
  withPerson,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import { createCrisisMut, setCrisisResponseProjectMut } from '../mutations/crisisMutations'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import type { HandleCrisisProject } from '../types/project'
import type { HoldingId, PolityId, HouseId, PersonId, ProvinceId, ProjectId } from '../types/ids'

const HOLDING = 'hl-1' as HoldingId
const POLITY = 'c-1' as PolityId
const HOUSE = 'h-1' as HouseId
const SUPERVISOR = 'p-sv' as PersonId

// 失効時 orphan 防止テスト用の bound fixture (hl-0 が province に属し polity owner が解決できる)。
const PROVINCE = 'pr-1' as ProvinceId
const BOUND_HOLDING = 'hl-0' as HoldingId

function makeBoundHandleCrisisProject(crisisId: string): HandleCrisisProject {
  return {
    id: 'pr-9' as ProjectId,
    owner: { kind: 'polity', id: POLITY },
    origin: { kind: 'system', reasonKey: 'crisis_response' },
    kind: 'handle_crisis',
    crisisId: crisisId as HandleCrisisProject['crisisId'],
    holdingId: BOUND_HOLDING,
    creatorPersonId: SUPERVISOR,
    supervisorPersonId: SUPERVISOR,
    status: 'active',
    progress: 5,
    targetProgress: 30,
    currentStageKey: 'mitigate',
    createdWeek: 0,
    deadlineWeek: 40,
    reasonIds: [],
    budget: { required: 20, allocated: 20, remaining: 12, spent: 8, source: { kind: 'owner' } },
  }
}

describe('handle_crisis 完了で Crisis を purge する (A6)', () => {
  it('completed handle_crisis Project → Crisis が crises/crisisIndex から消える', () => {
    let s = makeEmptyV016State()
    s = withPolity(s, POLITY, { treasury: 500 })
    s = withHouse(s, HOUSE)
    s = withPerson(s, SUPERVISOR, { houseId: HOUSE })

    const crisis = createCrisisMut(s, {
      kind: 'famine',
      holdingId: HOLDING,
      severity: 30,
      createdWeek: 0,
      deadlineWeek: 48,
      status: 'active',
      reasonIds: [],
    })

    const projectId = 'pr-1' as ProjectId
    const project: HandleCrisisProject = {
      id: projectId,
      owner: { kind: 'polity', id: POLITY },
      origin: { kind: 'system', reasonKey: 'crisis_response' },
      kind: 'handle_crisis',
      crisisId: crisis.id,
      holdingId: HOLDING,
      creatorPersonId: SUPERVISOR,
      supervisorPersonId: SUPERVISOR,
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

    const ctx = createTickContext({ state: s, rng: createRng('outcome'), config: defaultConfig })
    const next = runProjectOutcomeSystem(ctx)

    expect(next.state.crises[crisis.id]).toBeUndefined()
    expect(next.state.crisisIndex.byHolding[HOLDING as string]).toBeUndefined()
    expect(next.state.crisisIndex.byProject[projectId]).toBeUndefined()
  })
})

describe('Crisis 失効時に対処 Project を orphan 化させない', () => {
  it('deadline 到達で Crisis を purge する際、active な handle_crisis Project を failed/deadline_expired にする', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, PROVINCE)
    s = withPolity(s, POLITY, { treasury: 500, capitalProvinceId: PROVINCE })
    s = withHouse(s, HOUSE, { seatProvinceId: PROVINCE })
    s = withPerson(s, SUPERVISOR, { houseId: HOUSE })
    s = bindProvinceToHouseViaPolity(s, PROVINCE, POLITY, HOUSE)

    const crisis = createCrisisMut(s, {
      kind: 'famine',
      holdingId: BOUND_HOLDING,
      severity: 25,
      createdWeek: 0,
      deadlineWeek: 40,
      status: 'active',
      reasonIds: [],
    })
    const project = makeBoundHandleCrisisProject(crisis.id)
    s.projects[project.id] = project
    addProjectToIndexMut(s, project)
    setCrisisResponseProjectMut(s, crisis.id, project.id)

    // deadline (40) を過ぎ、かつ年初週でない (annual spawn を誘発しない) 週に進める
    s = { ...s, currentYear: 1, currentWeekOfYear: 2, absoluteWeek: 50 }

    const ctx = createTickContext({ state: s, rng: createRng('expire'), config: defaultConfig })
    const next = runCrisisSystem(ctx)

    // Crisis は purge され、対処 Project は orphan 化せず terminal になる
    expect(next.state.crises[crisis.id]).toBeUndefined()
    const p = next.state.projects[project.id]
    expect(p?.status).toBe('failed')
    expect(p?.terminalReason).toBe('deadline_expired')
  })

  it('owner polity inactive で Crisis を purge する際、active Project を cancelled/owner_inactive にする', () => {
    let s = makeEmptyV016State()
    s = withPolity(s, POLITY, { treasury: 500 })
    s = withHouse(s, HOUSE)
    s = withPerson(s, SUPERVISOR, { houseId: HOUSE })
    // 未 bound の holding → getHoldingTerminalPolityId が解決できず owner-inactive パスへ
    const crisis = createCrisisMut(s, {
      kind: 'famine',
      holdingId: BOUND_HOLDING,
      severity: 25,
      createdWeek: 0,
      deadlineWeek: 200,
      status: 'active',
      reasonIds: [],
    })
    const project = makeBoundHandleCrisisProject(crisis.id)
    s.projects[project.id] = project
    addProjectToIndexMut(s, project)
    setCrisisResponseProjectMut(s, crisis.id, project.id)
    s = { ...s, currentYear: 1, currentWeekOfYear: 2, absoluteWeek: 50 }

    const ctx = createTickContext({ state: s, rng: createRng('owner'), config: defaultConfig })
    const next = runCrisisSystem(ctx)

    expect(next.state.crises[crisis.id]).toBeUndefined()
    const p = next.state.projects[project.id]
    expect(p?.status).toBe('cancelled')
    expect(p?.terminalReason).toBe('owner_inactive')
  })
})
