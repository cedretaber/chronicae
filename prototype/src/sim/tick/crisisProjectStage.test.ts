import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { resolveImmediateStages } from './projectStageSystem'
import { createCrisisMut } from '../mutations/crisisMutations'
import type { HandleCrisisProject } from '../types/project'
import type { HoldingId, PolityId, PersonId, ProjectId } from '../types/ids'

const HOLDING = 'hl-1' as HoldingId
const POLITY = 'p-1' as PolityId

function makeCrisisProject(crisisId: string, required: number): HandleCrisisProject {
  return {
    id: 'pr-1' as ProjectId,
    owner: { kind: 'polity', id: POLITY },
    origin: { kind: 'system', reasonKey: 'crisis_response' },
    kind: 'handle_crisis',
    crisisId: crisisId as HandleCrisisProject['crisisId'],
    holdingId: HOLDING,
    creatorPersonId: 'pe-1' as PersonId,
    supervisorPersonId: 'pe-1' as PersonId,
    status: 'active',
    progress: 0,
    targetProgress: 30,
    currentStageKey: 'secure_budget',
    createdWeek: 0,
    reasonIds: [],
    budget: { required, allocated: 0, remaining: 0, spent: 0, source: { kind: 'owner' } },
  }
}

describe('handle_crisis secure_budget dispatch (v0.60 初期 fraction 確保)', () => {
  it('treasury 充足で初期 fraction(required×0.3) を確保・mitigate へ遷移・deadline は Crisis 由来', () => {
    const s = withPolity(makeEmptyV016State(), POLITY, { treasury: 1000 })
    const crisis = createCrisisMut(s, {
      kind: 'famine',
      holdingId: HOLDING,
      severity: 30,
      createdWeek: 0,
      deadlineWeek: 100,
      status: 'active',
      reasonIds: [],
    })
    const project = makeCrisisProject(crisis.id, 50)
    s.projects[project.id] = project

    resolveImmediateStages(s, defaultConfig, project.id, 0)

    // v0.60: required=50, projectInitialReserveFraction=0.3 → take=ceil(15)=15。
    expect(s.polities[POLITY]!.treasury).toBe(985)
    const updated = s.projects[project.id] as HandleCrisisProject
    expect(updated.currentStageKey).toBe('mitigate')
    expect(updated.budget.allocated).toBe(15)
    expect(updated.budget.remaining).toBe(15)
    expect(updated.budget.required).toBe(50) // required は不変 (不足分は raise_funds で集める)
    expect(updated.deadlineWeek).toBe(100) // Crisis.deadlineWeek を単一の真実に
  })

  it('treasury 不足でもハード失敗せず stock 分だけ確保して mitigate へ進む (v0.60)', () => {
    const s = withPolity(makeEmptyV016State(), POLITY, { treasury: 10 })
    const crisis = createCrisisMut(s, {
      kind: 'famine',
      holdingId: HOLDING,
      severity: 30,
      createdWeek: 0,
      deadlineWeek: 100,
      status: 'active',
      reasonIds: [],
    })
    const project = makeCrisisProject(crisis.id, 50)
    s.projects[project.id] = project

    resolveImmediateStages(s, defaultConfig, project.id, 0)

    // target=15 だが treasury=10 → take=min(15,10)=10。停滞せず前進する。
    expect(s.polities[POLITY]!.treasury).toBe(0)
    const updated = s.projects[project.id] as HandleCrisisProject
    expect(updated.currentStageKey).toBe('mitigate')
    expect(updated.budget.allocated).toBe(10)
  })
})
