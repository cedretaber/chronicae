// v0.60: budget 枯渇時の raise_funds back-edge / 最大ラウンド超で budget_exhausted。
import { describe, expect, it } from 'vitest'
import {
  makeEmptyV016State,
  withHouse,
  withPolity,
  withPerson,
  withProvince,
  withHolding,
} from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import { runProjectMaintenanceSystem } from './projectMaintenanceSystem'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import type { WorldState } from '../types/world'
import type { DevelopHoldingProject } from '../types/project'
import {
  createPolityId,
  createHouseId,
  createHoldingId,
  createProvinceId,
  createPersonId,
} from '../types/ids'
import type { ProjectId } from '../types/ids'

const POLITY = createPolityId('c', 0)
const HOUSE = createHouseId('h', 0)
const PROV = createProvinceId('p', 0)
const HOLD = createHoldingId(0)
const CREATOR = createPersonId('pe', 1)

function makeState(): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROV)
  s = withHolding(s, HOLD, PROV)
  s = withHouse(s, HOUSE)
  s = withPolity(s, POLITY, { ownerHouseId: HOUSE, treasury: 0 })
  s = withPerson(s, CREATOR, { houseId: HOUSE })
  return s
}

function makeExhaustedProject(fundingRoundCount: number): DevelopHoldingProject {
  return {
    id: 'proj-m' as ProjectId,
    owner: { kind: 'polity', id: POLITY },
    origin: { kind: 'system', reasonKey: 'test' },
    kind: 'develop_holding',
    creatorPersonId: CREATOR,
    supervisorPersonId: CREATOR,
    status: 'active',
    progress: 40,
    targetProgress: 100,
    currentStageKey: 'execute_project',
    createdWeek: 0,
    deadlineWeek: 99999,
    reasonIds: [],
    holdingId: HOLD,
    improvementKind: 'irrigation_infrastructure',
    targetImprovementLevel: 1,
    budget: { required: 1000, allocated: 300, remaining: 0, spent: 300, source: { kind: 'owner' } },
    fundingRoundCount,
  }
}

function run(project: DevelopHoldingProject): DevelopHoldingProject {
  const s = makeState()
  s.projects[project.id] = project
  addProjectToIndexMut(s, project)
  const ctx = createTickContext({ state: s, rng: createRng('m'), config: defaultConfig })
  const out = runProjectMaintenanceSystem(ctx)
  return out.state.projects[project.id] as DevelopHoldingProject
}

describe('v0.60 budget 枯渇 → raise_funds back-edge', () => {
  it('枯渇かつ round 未上限 → raise_funds に遷移し active のまま', () => {
    const project = run(makeExhaustedProject(0))
    expect(project.status).toBe('active')
    expect(project.currentStageKey).toBe('raise_funds')
  })

  it('round 上限到達で枯渇 → budget_exhausted 失敗', () => {
    const project = run(makeExhaustedProject(defaultConfig.projectMaxFundingRounds))
    expect(project.status).toBe('failed')
    expect(project.terminalReason).toBe('budget_exhausted')
  })
})
