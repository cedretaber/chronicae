import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { handleAdvanceProjectCompletionMut } from './taskProjectCompletion'
import type { HandleCrisisProject } from '../types/project'
import type { HoldingId, PolityId, PersonId, ProjectId, CrisisId } from '../types/ids'

function makeProject(): HandleCrisisProject {
  return {
    id: 'pr-1' as ProjectId,
    owner: { kind: 'polity', id: 'c-1' as PolityId },
    origin: { kind: 'system', reasonKey: 'crisis_response' },
    kind: 'handle_crisis',
    crisisId: 'cr-1' as CrisisId,
    holdingId: 'hl-1' as HoldingId,
    creatorPersonId: 'p-1' as PersonId,
    supervisorPersonId: 'p-1' as PersonId,
    status: 'active',
    progress: 0,
    targetProgress: 30,
    currentStageKey: 'mitigate',
    createdWeek: 0,
    reasonIds: [],
    budget: { required: 60, allocated: 60, remaining: 60, spent: 0, source: { kind: 'owner' } },
  }
}

describe('handle_crisis budget 消費の一般化 (A7)', () => {
  it('advance task 成功で progress 増・budget.spent 増・remaining 減', () => {
    const s = makeEmptyV016State()
    const project = makeProject()
    s.projects[project.id] = project

    handleAdvanceProjectCompletionMut(s, defaultConfig, project.id, 'success')

    const updated = s.projects[project.id] as HandleCrisisProject
    expect(updated.progress).toBeGreaterThan(0)
    expect(updated.budget.spent).toBeGreaterThan(0)
    expect(updated.budget.remaining).toBeLessThan(60)
    expect(updated.budget.remaining + updated.budget.spent).toBeCloseTo(60)
  })
})
