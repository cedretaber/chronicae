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

describe('handle_crisis secure_budget dispatch (A4 funding 一般化)', () => {
  it('treasury 充足で treasury -= required・mitigate へ遷移・deadline は Crisis 由来', () => {
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

    expect(s.polities[POLITY]!.treasury).toBe(950)
    const updated = s.projects[project.id] as HandleCrisisProject
    expect(updated.currentStageKey).toBe('mitigate')
    expect(updated.budget.allocated).toBe(50)
    expect(updated.budget.remaining).toBe(50)
    expect(updated.deadlineWeek).toBe(100) // Crisis.deadlineWeek を単一の真実に
  })

  it('treasury 不足では secure_budget に停滞し treasury は不変 (放置)', () => {
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

    expect(s.polities[POLITY]!.treasury).toBe(10)
    expect((s.projects[project.id] as HandleCrisisProject).currentStageKey).toBe('secure_budget')
  })
})
