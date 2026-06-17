import { describe, it, expect } from 'vitest'
import { getChronicleEntriesForWar } from './chronicleSelectors'
import { makeEmptyV016State } from '../testFixtures'
import { createChronicleEntryId, createEventId } from '../types/ids'
import type { ChronicleEntry } from '../types/chronicle'
import type { WorldState } from '../types/world'
import type { WarId } from '../types/ids'

// v0.49 §16.2: getChronicleEntriesForWar は chronicleIndex.byWar 経由で取得する。
//   war 系 chronicle event は war entityRef を持ち indexBucketForKind('war') が byWar に振る。
function makeEntry(
  n: number,
  warIdValue: string,
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
    params: { warId: warIdValue },
    entityRefs: [{ kind: 'war', id: warIdValue }],
  }
}

// chronicleEntries に格納し byWar index に登録する (createChronicleEntryMut の index 効果を再現)。
function addEntry(state: WorldState, entry: ChronicleEntry): void {
  state.chronicleEntries[entry.id] = entry
  for (const ref of entry.entityRefs) {
    if (ref.kind !== 'war') continue
    const arr = state.chronicleIndex.byWar[ref.id]
    if (arr) arr.push(entry.id)
    else state.chronicleIndex.byWar[ref.id] = [entry.id]
  }
}

describe('getChronicleEntriesForWar', () => {
  it('byWar index で対象 war の entry のみ返す', () => {
    const state = makeEmptyV016State()
    addEntry(state, makeEntry(1, 'w-1', 10, 5))
    addEntry(state, makeEntry(2, 'w-2', 10, 10))
    addEntry(state, makeEntry(3, 'w-1', 12, 1))

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    expect(result).toHaveLength(2)
    expect(result.every((e) => (e.params.warId as string) === 'w-1')).toBe(true)
  })

  it('該当 war が byWar に無ければ空配列', () => {
    const state = makeEmptyV016State()
    addEntry(state, makeEntry(1, 'w-2', 10, 5))

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    expect(result).toHaveLength(0)
  })

  it('byWar が参照する欠損 id は除外する', () => {
    const state = makeEmptyV016State()
    addEntry(state, makeEntry(1, 'w-1', 10, 5))
    // 欠損 id を byWar に積む (record 側には無い)。
    state.chronicleIndex.byWar['w-1']!.push(createChronicleEntryId(99))

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    expect(result).toHaveLength(1)
  })

  it('時系列降順 (新しい順) に並べる', () => {
    const state = makeEmptyV016State()
    addEntry(state, makeEntry(1, 'w-1', 10, 5))
    addEntry(state, makeEntry(2, 'w-1', 10, 20))
    addEntry(state, makeEntry(3, 'w-1', 12, 1))

    const result = getChronicleEntriesForWar(state, 'w-1' as WarId)

    const tuples = result.map((e) => [e.year, e.weekOfYear] as const)
    expect(tuples).toEqual([
      [12, 1],
      [10, 20],
      [10, 5],
    ])
  })
})
