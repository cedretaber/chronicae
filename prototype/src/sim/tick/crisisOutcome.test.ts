import { describe, it, expect } from 'vitest'
import { runProjectOutcomeSystem } from './projectOutcomeSystem'
import { makeEmptyV016State, withPolity, withHouse, withPerson } from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import { createCrisisMut, setCrisisResponseProjectMut } from '../mutations/crisisMutations'
import { addProjectToIndexMut } from '../mutations/projectMutations'
import type { HandleCrisisProject } from '../types/project'
import type { HoldingId, PolityId, HouseId, PersonId, ProjectId } from '../types/ids'

const HOLDING = 'hl-1' as HoldingId
const POLITY = 'c-1' as PolityId
const HOUSE = 'h-1' as HouseId
const SUPERVISOR = 'p-sv' as PersonId

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
