import { describe, it, expect } from 'vitest'
import { runChronicleProjectionSystem } from './chronicleProjectionSystem'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { makeEmptyV016State } from '../testFixtures'
import { entityRef } from '../types/event'
import type { SimEvent, EventType, EventImportance } from '../types/event'

function makeEvent(
  n: number,
  year: number,
  weekOfYear: number,
  type: EventType,
  importance: EventImportance,
  messageKey: string,
  entityRefs: SimEvent['entityRefs'],
): SimEvent {
  return {
    id: `e-${n}` as SimEvent['id'],
    year,
    weekOfYear,
    type,
    importance,
    messageKey,
    messageParams: {},
    entityRefs,
    reasons: [],
    effects: [],
  }
}

describe('runChronicleProjectionSystem', () => {
  it('indexes an office event (retainRefKinds person) only in byPerson, dropping polity ref', () => {
    const state = makeEmptyV016State()
    const events = [
      makeEvent(1, 1, 1, 'OFFICE_ASSIGNED', 'normal', 'office.assigned_polity', [
        entityRef('person', 'pe-1', 'appointee'),
        entityRef('polity', 'c-1', 'organization'),
      ]),
    ]
    const base = createTickContext({ state, rng: createRng('test'), config: defaultConfig })
    const ctx = { ...base, events }
    const result = runChronicleProjectionSystem(ctx)

    const entries = Object.values(result.state.chronicleEntries)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry).toBeDefined()
    expect(entry?.entityRefs).toHaveLength(1)
    expect(entry?.entityRefs[0]?.kind).toBe('person')

    expect(result.state.chronicleIndex.byPerson['pe-1']).toHaveLength(1)
    expect(result.state.chronicleIndex.byPolity['c-1']).toBeUndefined()
  })

  it('indexes a governance event (no retainRefKinds) across all matching axes', () => {
    const state = makeEmptyV016State()
    const events = [
      makeEvent(2, 1, 1, 'POLITY_OWNER_CHANGED', 'major', 'polity.owner_changed', [
        entityRef('polity', 'c-1'),
        entityRef('house', 'h-1'),
      ]),
    ]
    const base = createTickContext({ state, rng: createRng('test'), config: defaultConfig })
    const ctx = { ...base, events }
    const result = runChronicleProjectionSystem(ctx)

    expect(result.state.chronicleIndex.byPolity['c-1']).toHaveLength(1)
    expect(result.state.chronicleIndex.byHouse['h-1']).toHaveLength(1)

    const entries = Object.values(result.state.chronicleEntries)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entityRefs).toHaveLength(2)
  })

  it('does not project a non-allowlisted event', () => {
    const state = makeEmptyV016State()
    const events = [
      makeEvent(3, 1, 1, 'PERSON_DIED', 'minor', 'person.died', [entityRef('person', 'pe-2')]),
    ]
    const base = createTickContext({ state, rng: createRng('test'), config: defaultConfig })
    const ctx = { ...base, events }
    const result = runChronicleProjectionSystem(ctx)

    expect(Object.keys(result.state.chronicleEntries)).toHaveLength(0)
  })

  it('copies event.messageKey into templateKey when no override', () => {
    const state = makeEmptyV016State()
    const events = [
      makeEvent(4, 1, 1, 'POLITY_OWNER_CHANGED', 'major', 'polity.owner_changed', [
        entityRef('polity', 'c-1'),
        entityRef('house', 'h-1'),
      ]),
    ]
    const base = createTickContext({ state, rng: createRng('test'), config: defaultConfig })
    const ctx = { ...base, events }
    const result = runChronicleProjectionSystem(ctx)

    const entries = Object.values(result.state.chronicleEntries)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.templateKey).toBe('polity.owner_changed')
  })
})
