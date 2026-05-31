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
  messageParams: SimEvent['messageParams'] = {},
): SimEvent {
  return {
    id: `e-${n}` as SimEvent['id'],
    year,
    weekOfYear,
    type,
    importance,
    messageKey,
    messageParams,
    entityRefs,
    reasons: [],
    effects: [],
  }
}

// BATTLE_OCCURRED イベントを 1 件だけ projection し、生成 entry の templateKey を返す。
//   selectBattleTemplate の優先カスケードを projection の配線越しに固定する。
function battleTemplateKey(params: SimEvent['messageParams']): string | undefined {
  const state = makeEmptyV016State()
  const events = [
    makeEvent(1, 1, 1, 'BATTLE_OCCURRED', 'normal', 'war.battle_occurred', [], params),
  ]
  const base = createTickContext({ state, rng: createRng('test'), config: defaultConfig })
  const result = runChronicleProjectionSystem({ ...base, events })
  return Object.values(result.state.chronicleEntries)[0]?.templateKey
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

describe('selectBattleTemplate (BATTLE_OCCURRED の chronicle templateKey 選択)', () => {
  it('outnumberedVictory を最優先で chronicle.battle.outnumbered_victory に', () => {
    expect(
      battleTemplateKey({
        result: 'attacker_victory',
        outnumberedVictory: true,
        decisiveVictory: true, // outnumbered が優先される
        attackerRoutedCount: 3,
      }),
    ).toBe('chronicle.battle.outnumbered_victory')
  })

  it('decisiveVictory (rout) を chronicle.battle.decisive_victory に', () => {
    expect(
      battleTemplateKey({
        result: 'defender_victory',
        outnumberedVictory: false,
        decisiveVictory: true,
      }),
    ).toBe('chronicle.battle.decisive_victory')
  })

  it('勝者自身も壊走連隊を出した辛勝を chronicle.battle.narrow_victory に', () => {
    expect(
      battleTemplateKey({
        result: 'attacker_victory',
        outnumberedVictory: false,
        decisiveVictory: false,
        attackerRoutedCount: 2, // 勝者(attacker)自身の壊走 > 0
        defenderRoutedCount: 1,
      }),
    ).toBe('chronicle.battle.narrow_victory')
  })

  it('通常勝利 (壊走なし・特徴なし) は既存 war.battle_occurred を流用', () => {
    expect(
      battleTemplateKey({
        result: 'attacker_victory',
        outnumberedVictory: false,
        decisiveVictory: false,
        attackerRoutedCount: 0,
        defenderRoutedCount: 1,
      }),
    ).toBe('war.battle_occurred')
  })

  it('非勝利 (inconclusive) は war.battle_occurred', () => {
    expect(
      battleTemplateKey({
        result: 'inconclusive',
        outnumberedVictory: false,
        decisiveVictory: false,
      }),
    ).toBe('war.battle_occurred')
  })
})
