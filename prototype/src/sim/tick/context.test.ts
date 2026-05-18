import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { HouseId, PersonId, EventId } from '../types/ids'
import type { Person } from '../types/person'
import { createTickContext, makeEventId, makePersonId, toResult } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeMinimalWorld(personIds: PersonId[] = []): WorldState {
  const persons: Record<PersonId, Person> = {}
  for (const id of personIds) {
    persons[id] = {
      id,
      name: 'Test',
      sex: 'male',
      age: 30,
      alive: true,
      houseId: 'h-0' as HouseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 10,
      wealth: 0,
      attitudes: {},
    }
  }
  return {
    currentYear: 1,
    currentMonth: 1,
    provinces: {},
    polities: {},
    houses: {},
    persons,
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  }
}

function makeConfig() {
  return defaultConfig
}

describe('createTickContext', () => {
  it('sets nextPersonIndex=0 when no persons exist', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(0)
  })

  it('sets nextPersonIndex to max index + 1 from existing persons (pe-0, pe-5, pe-12 -> 13)', () => {
    const personIds: PersonId[] = ['pe-0' as PersonId, 'pe-5' as PersonId, 'pe-12' as PersonId]
    const state = makeMinimalWorld(personIds)
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(13)
  })
})

describe('createTickContext nextEventIndex', () => {
  it('sets nextEventIndex=0', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextEventIndex).toBe(0)
  })
})

describe('makeEventId', () => {
  it('returns id in format e-{year}-{month}-{index} and increments nextEventIndex', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextEventIndex).toBe(0)

    const { id, ctx: updatedCtx } = makeEventId(ctx)
    expect(id).toBe('e-1-1-0')
    expect(updatedCtx.nextEventIndex).toBe(1)

    const { id: id2, ctx: updatedCtx2 } = makeEventId(updatedCtx)
    expect(id2).toBe('e-1-1-1')
    expect(updatedCtx2.nextEventIndex).toBe(2)
  })

  it('does not mutate ctx', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    const originalNextEventIndex = ctx.nextEventIndex

    makeEventId(ctx)

    expect(ctx.nextEventIndex).toBe(originalNextEventIndex)
  })
})

describe('makePersonId', () => {
  it('returns id in format pe-{index} and increments nextPersonIndex', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })
    expect(ctx.nextPersonIndex).toBe(0)

    const { id, ctx: updatedCtx } = makePersonId(ctx)
    expect(id).toBe('pe-0' as PersonId)
    expect(updatedCtx.nextPersonIndex).toBe(1)

    const { id: id2, ctx: updatedCtx2 } = makePersonId(updatedCtx)
    expect(id2).toBe('pe-1' as PersonId)
    expect(updatedCtx2.nextPersonIndex).toBe(2)
  })
})

describe('toResult', () => {
  it('returns state, rng, and events as array', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })

    const result = toResult(ctx)

    expect(result.state).toBe(state)
    expect(result.rng).toBe(rng)
    expect(Array.isArray(result.events)).toBe(true)
    expect(result.events).toHaveLength(0)
  })

  it('events array is a copy, not the same reference', () => {
    const state = makeMinimalWorld()
    const rng = createRng('test')
    const config = makeConfig()
    const ctx = createTickContext({ state, rng, config })

    const result = toResult(ctx)
    result.events.push({
      id: 'e-1-1-99' as EventId,
      year: 1,
      month: 1,
      type: 'PERSON_DIED',
      importance: 'minor',
      actorIds: [],
      houseIds: [],
      polityIds: [],
      provinceIds: [],
      summary: 'test',
      reasons: [],
      effects: [],
    })

    const result2 = toResult(ctx)
    expect(result2.events).toHaveLength(0)
  })
})
