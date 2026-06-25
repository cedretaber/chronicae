import { describe, it, expect, beforeEach } from 'vitest'
import { runChronicleProjectionSystem, resetChronicleEntryIndex } from './chronicleProjectionSystem'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { makeEmptyV016State } from '../testFixtures'
import { entityRef } from '../types/event'
import type { SimEvent, EventType, EventImportance } from '../types/event'
import type { ChronicleEntry } from '../types/chronicle'
import type { ChronicleWriter } from '../chronicle/chronicleStore'

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

function createCollectingWriter(): ChronicleWriter & { collected: ChronicleEntry[] } {
  const collected: ChronicleEntry[] = []
  return {
    collected,
    append(entries: ChronicleEntry[]) {
      collected.push(...entries)
    },
    flush() {
      return Promise.resolve()
    },
    clear() {
      return Promise.resolve()
    },
  }
}

function battleTemplateKey(params: SimEvent['messageParams']): string | undefined {
  const state = makeEmptyV016State()
  const writer = createCollectingWriter()
  const events = [
    makeEvent(1, 1, 1, 'BATTLE_OCCURRED', 'normal', 'war.battle_occurred', [], params),
  ]
  const base = createTickContext({
    state,
    rng: createRng('test'),
    config: defaultConfig,
    chronicleWriter: writer,
  })
  runChronicleProjectionSystem({ ...base, events })
  return writer.collected[0]?.templateKey
}

describe('runChronicleProjectionSystem', () => {
  beforeEach(() => {
    resetChronicleEntryIndex()
  })

  it('projects an office event (retainRefKinds person), dropping polity ref', () => {
    const state = makeEmptyV016State()
    const writer = createCollectingWriter()
    const events = [
      makeEvent(1, 1, 1, 'OFFICE_ASSIGNED', 'normal', 'office.assigned_polity', [
        entityRef('person', 'pe-1', 'appointee'),
        entityRef('polity', 'c-1', 'organization'),
      ]),
    ]
    const base = createTickContext({
      state,
      rng: createRng('test'),
      config: defaultConfig,
      chronicleWriter: writer,
    })
    runChronicleProjectionSystem({ ...base, events })

    expect(writer.collected).toHaveLength(1)
    const entry = writer.collected[0]!
    expect(entry.entityRefs).toHaveLength(1)
    expect(entry.entityRefs[0]?.kind).toBe('person')
  })

  it('projects a governance event with all matching entity refs', () => {
    const state = makeEmptyV016State()
    const writer = createCollectingWriter()
    const events = [
      makeEvent(2, 1, 1, 'POLITY_OWNER_CHANGED', 'major', 'polity.owner_changed', [
        entityRef('polity', 'c-1'),
        entityRef('house', 'h-1'),
      ]),
    ]
    const base = createTickContext({
      state,
      rng: createRng('test'),
      config: defaultConfig,
      chronicleWriter: writer,
    })
    runChronicleProjectionSystem({ ...base, events })

    expect(writer.collected).toHaveLength(1)
    expect(writer.collected[0]?.entityRefs).toHaveLength(2)
  })

  it('does not project a non-allowlisted event', () => {
    const state = makeEmptyV016State()
    const writer = createCollectingWriter()
    const events = [
      makeEvent(3, 1, 1, 'PERSON_DIED', 'minor', 'person.died', [entityRef('person', 'pe-2')]),
    ]
    const base = createTickContext({
      state,
      rng: createRng('test'),
      config: defaultConfig,
      chronicleWriter: writer,
    })
    runChronicleProjectionSystem({ ...base, events })

    expect(writer.collected).toHaveLength(0)
  })

  it('projects a faction event keeping all entity refs', () => {
    const state = makeEmptyV016State()
    const writer = createCollectingWriter()
    const events = [
      makeEvent(5, 1, 1, 'FACTION_FOUNDED', 'normal', 'faction.founded', [
        entityRef('person', 'pe-1', 'leader'),
        entityRef('faction', 'fa-1', 'faction'),
        entityRef('person', 'pe-2', 'member'),
      ]),
    ]
    const base = createTickContext({
      state,
      rng: createRng('test'),
      config: defaultConfig,
      chronicleWriter: writer,
    })
    runChronicleProjectionSystem({ ...base, events })

    expect(writer.collected).toHaveLength(1)
    expect(writer.collected[0]?.category).toBe('faction')
    expect(writer.collected[0]?.entityRefs).toHaveLength(3)
  })

  it('copies event.messageKey into templateKey when no override', () => {
    const state = makeEmptyV016State()
    const writer = createCollectingWriter()
    const events = [
      makeEvent(4, 1, 1, 'POLITY_OWNER_CHANGED', 'major', 'polity.owner_changed', [
        entityRef('polity', 'c-1'),
        entityRef('house', 'h-1'),
      ]),
    ]
    const base = createTickContext({
      state,
      rng: createRng('test'),
      config: defaultConfig,
      chronicleWriter: writer,
    })
    runChronicleProjectionSystem({ ...base, events })

    expect(writer.collected).toHaveLength(1)
    expect(writer.collected[0]?.templateKey).toBe('polity.owner_changed')
  })

  it('does nothing when no writer is injected', () => {
    const state = makeEmptyV016State()
    const events = [
      makeEvent(6, 1, 1, 'POLITY_OWNER_CHANGED', 'major', 'polity.owner_changed', [
        entityRef('polity', 'c-1'),
      ]),
    ]
    const base = createTickContext({
      state,
      rng: createRng('test'),
      config: defaultConfig,
    })
    const ctx = { ...base, events }
    const result = runChronicleProjectionSystem(ctx)
    expect(result).toBe(ctx)
  })
})

describe('selectBattleTemplate (BATTLE_OCCURRED の chronicle templateKey 選択)', () => {
  beforeEach(() => {
    resetChronicleEntryIndex()
  })

  it('outnumberedVictory を最優先で chronicle.battle.outnumbered_victory に', () => {
    expect(
      battleTemplateKey({
        result: 'attacker_victory',
        outnumberedVictory: true,
        decisiveVictory: true,
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
        attackerRoutedCount: 2,
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

  it('非勝利 (inconclusive) は war.battle_occurred_inconclusive', () => {
    expect(
      battleTemplateKey({
        result: 'inconclusive',
        outnumberedVictory: false,
        decisiveVictory: false,
      }),
    ).toBe('war.battle_occurred_inconclusive')
  })
})
