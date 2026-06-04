import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import { emitWarAverted, emitBattleOccurred } from './warEvents'
import type { BattleOccurredInput } from './warEvents'
import { createWar } from '../mutations/warMutations'
import type { OrganizationRef } from '../types/office'
import type { PolityId } from '../types/ids'

// war.averted は helper 経由 emit (positional params) かつ default preset では発火しないため、
// 静的・runtime いずれの messageParamCoverage テストの網にもかからない (advisor 指摘)。
// この unit test が emit 側 params ⊇ yaml placeholders を保証する durable な回帰保護。
function placeholdersFor(key: string): Set<string> {
  const out = new Set<string>()
  for (const loc of ['ja', 'en']) {
    const path = fileURLToPath(new URL(`../../i18n/locales/${loc}/events.yaml`, import.meta.url))
    const doc = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>
    const node = key.split('.').reduce<unknown>((acc, k) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k]
      return undefined
    }, doc)
    if (typeof node === 'string') {
      for (const m of node.matchAll(/\{\{(\w+)\}\}/g)) out.add(m[1] as string)
    }
  }
  return out
}

describe('emitWarAverted', () => {
  it('WAR_AVERTED の messageParams が war.averted の placeholder を全て満たす', () => {
    let state = makeEmptyV016State()
    const attacker = 'c-att' as PolityId
    const defender = 'c-def' as PolityId
    state = withPolity(state, attacker, { rank: 2 })
    state = withPolity(state, defender, { rank: 2 })
    const ctx = createTickContext({ state, rng: createRng('war-averted'), config: defaultConfig })

    const a: OrganizationRef = { kind: 'polity', id: attacker }
    const d: OrganizationRef = { kind: 'polity', id: defender }
    const next = emitWarAverted(ctx, a, d, 0.43, 0.45)

    const event = next.events.find((e) => e.type === 'WAR_AVERTED')
    expect(event).toBeDefined()
    expect(event?.messageKey).toBe('war.averted')

    const provided = new Set(Object.keys(event?.messageParams ?? {}))
    const needed = placeholdersFor('war.averted')
    expect(needed.size).toBeGreaterThan(0)
    const missing = [...needed].filter((p) => !provided.has(p))
    expect(missing, `missing placeholders: ${missing.join(', ')}`).toEqual([])
  })
})

describe('emitBattleOccurred outnumberedVictory', () => {
  // outnumberedVictory は連隊数で判定する (effectivePower 基準ではない)。
  // chronicle template が連隊数を表示して「数的劣勢を覆した」と描写するため、判定根拠を一致させる。
  function setup() {
    let state = makeEmptyV016State()
    const attacker = 'c-att' as PolityId
    const defender = 'c-def' as PolityId
    state = withPolity(state, attacker, { rank: 2 })
    state = withPolity(state, defender, { rank: 2 })
    const war = createWar(state, {
      attacker: { kind: 'polity', id: attacker },
      defender: { kind: 'polity', id: defender },
      warGoals: [],
      targetWarScore: 60,
      startedWeek: 48,
    })
    const ctx = createTickContext({ state, rng: createRng('battle'), config: defaultConfig })
    return { ctx, war }
  }

  function baseInput(overrides: Partial<BattleOccurredInput>): BattleOccurredInput {
    return {
      battlefieldKind: 'open_field',
      initiationKind: 'mutual_engagement',
      result: 'attacker_victory',
      attackerPower: 100,
      defenderPower: 100,
      attackerEffectivePower: 100,
      defenderEffectivePower: 100,
      warScoreDelta: 6,
      warScoreAfter: 6,
      battleId: 'b-0',
      attackerRegimentCount: 2,
      defenderRegimentCount: 2,
      ...overrides,
    }
  }

  function lastBattleParams(overrides: Partial<BattleOccurredInput>) {
    const { ctx, war } = setup()
    const next = emitBattleOccurred(ctx, war, baseInput(overrides))
    const event = next.events.find((e) => e.type === 'BATTLE_OCCURRED')
    return event?.messageParams
  }

  it('勝者の連隊数が少ない (数的劣勢を覆した) なら true', () => {
    // defender が 4 連隊で勝利、attacker は 2 連隊 → defender は数的劣勢ではない。
    // attacker_victory で attacker 2 < defender 4 → 数的劣勢を覆した勝利。
    const params = lastBattleParams({
      result: 'attacker_victory',
      attackerRegimentCount: 2,
      defenderRegimentCount: 4,
    })
    expect(params?.outnumberedVictory).toBe(true)
  })

  it('勝者の連隊数が多い (報告ケース: 4 連隊が 2 連隊に勝利) なら false', () => {
    // ユーザー報告のバグ再現: defender 4 連隊が attacker 2 連隊に勝利。
    // effectivePower 基準だと誤って true になっていた。連隊数基準では false。
    const params = lastBattleParams({
      result: 'defender_victory',
      attackerRegimentCount: 2,
      defenderRegimentCount: 4,
      attackerEffectivePower: 150, // 戦力では attacker (敗者) が上 = 旧ロジックの罠
      defenderEffectivePower: 100,
    })
    expect(params?.outnumberedVictory).toBe(false)
  })

  it('連隊数が同数なら false', () => {
    const params = lastBattleParams({
      result: 'attacker_victory',
      attackerRegimentCount: 3,
      defenderRegimentCount: 3,
    })
    expect(params?.outnumberedVictory).toBe(false)
  })

  it('inconclusive なら false', () => {
    const params = lastBattleParams({
      result: 'inconclusive',
      attackerRegimentCount: 1,
      defenderRegimentCount: 4,
    })
    expect(params?.outnumberedVictory).toBe(false)
  })
})
