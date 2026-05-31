import { describe, it, expect } from 'vitest'
import { getChronicleEntriesForWar } from './chronicleSelectors'
import { makeEmptyV016State } from '../testFixtures'
import { createChronicleEntryId, createEventId } from '../types/ids'
import type { ChronicleEntry } from '../types/chronicle'
import type { WarId } from '../types/ids'

function makeEntry(
  n: number,
  warIdValue: unknown,
  year: number,
  weekOfYear: number,
): ChronicleEntry {
  return {
    id: createChronicleEntryId(n),
    year,
    weekOfYear,
    category: 'war',
    importance: 'normal',
    sourceEventId: createEventId('ev', n),
    sourceEventType: 'WAR_DECLARED',
    templateKey: 'test.key',
    params: { warId: warIdValue } as ChronicleEntry['params'],
    entityRefs: [],
  }
}

describe('getChronicleEntriesForWar', () => {
  it('returns only entries whose params.warId matches the given warId', () => {
    const state = makeEmptyV016State()
    const entryA = makeEntry(1, 'w-1', 10, 5)
    const entryB = makeEntry(2, 'w-2', 10, 10)
    const entryC = makeEntry(3, 'w-1', 12, 1)
    state.chronicleEntries[entryA.id] = entryA
    state.chronicleEntries[entryB.id] = entryB
    state.chronicleEntries[entryC.id] = entryC

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    expect(result).toHaveLength(2)
    expect(result.every((e) => (e.params.warId as string) === 'w-1')).toBe(true)
  })

  it('returns empty array when no entries match', () => {
    const state = makeEmptyV016State()
    const entryA = makeEntry(1, 'w-2', 10, 5)
    state.chronicleEntries[entryA.id] = entryA

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    expect(result).toHaveLength(0)
  })

  it('ignores entries whose params.warId is not a string', () => {
    const state = makeEmptyV016State()
    const entryA = makeEntry(1, 'w-1', 10, 5)
    const entryB = makeEntry(2, 123, 12, 1)
    state.chronicleEntries[entryA.id] = entryA
    state.chronicleEntries[entryB.id] = entryB

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    expect(result).toHaveLength(1)
  })

  it('sorts results in descending chronological order (newest first)', () => {
    const state = makeEmptyV016State()
    const entryA = makeEntry(1, 'w-1', 10, 5)
    const entryB = makeEntry(2, 'w-1', 10, 20)
    const entryC = makeEntry(3, 'w-1', 12, 1)
    state.chronicleEntries[entryA.id] = entryA
    state.chronicleEntries[entryB.id] = entryB
    state.chronicleEntries[entryC.id] = entryC

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    const tuples = result.map((e) => [e.year, e.weekOfYear] as const)
    expect(tuples).toEqual([
      [12, 1],
      [10, 20],
      [10, 5],
    ])
  })
})
