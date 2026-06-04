import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import { emitWarAverted } from './warEvents'
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
