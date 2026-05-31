import { describe, it, expect } from 'vitest'
import { simulateBattle } from './simulateBattle'
import type { BattleSimInput, BattleSimRegimentInput } from './simulateBattle'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import type { RegimentId, BattleId, WarId } from '../types/ids'
import type { WarSideKey } from '../types/war'

// v0.37 §6-12 simulateBattle pure helper の単体テスト。
//   決定性 / deployment 規則 / rout 発火 / 両端ケース (0 連隊 auto-resolve, frontage 1)。

function reg(
  id: string,
  side: WarSideKey,
  overrides: Partial<BattleSimRegimentInput> = {},
): BattleSimRegimentInput {
  return {
    regimentId: id as RegimentId,
    side,
    troopKind: 'infantry',
    strength: 100,
    organization: 50,
    morale: 30,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    basePower: 100,
    effectivePower: 75, // basePower × strengthFactor(1) × orgFactor(0.5+0.5×0.5=0.75)
    ...overrides,
  }
}

function makeInput(
  attacker: BattleSimRegimentInput[],
  defender: BattleSimRegimentInput[],
  overrides: Partial<BattleSimInput> = {},
): BattleSimInput {
  return {
    battleId: 'bt-1' as BattleId,
    warId: 'w-1' as WarId,
    battlefieldKind: 'open_field',
    frontage: 5,
    tickUnit: 'day',
    maxTicks: 5,
    attacker,
    defender,
    attackerCommanders: [],
    defenderCommanders: [],
    config: defaultConfig,
    rng: createRng('battle-test'),
    ...overrides,
  }
}

describe('simulateBattle determinism', () => {
  it('same input → same output (result, rng, regimentResults)', () => {
    const inp = makeInput(
      [reg('a1', 'attacker'), reg('a2', 'attacker', { troopKind: 'cavalry' })],
      [reg('d1', 'defender'), reg('d2', 'defender')],
    )
    const r1 = simulateBattle(inp)
    const r2 = simulateBattle(inp)
    expect(r2).toEqual(r1)
  })

  it('does not mutate input regiments', () => {
    const atk = [reg('a1', 'attacker', { organization: 50 })]
    const inp = makeInput(atk, [reg('d1', 'defender')])
    simulateBattle(inp)
    expect(atk[0]!.organization).toBe(50) // input snapshot untouched
  })
})

describe('simulateBattle deployment (§6.3)', () => {
  it('infantry が frontline 優先 (cavalry は reserve 優先)', () => {
    // frontage 2。infantry 3 + cavalry 1 (cavalry の power が最高でも frontline は infantry)。
    const atk = [
      reg('i1', 'attacker', { effectivePower: 30 }),
      reg('i2', 'attacker', { effectivePower: 20 }),
      reg('i3', 'attacker', { effectivePower: 10 }),
      reg('c1', 'attacker', { troopKind: 'cavalry', effectivePower: 100 }),
    ]
    const r = simulateBattle(makeInput(atk, [reg('d1', 'defender')], { frontage: 2 }))
    // 上位 2 infantry が初期 frontline。cavalry は出ない。
    expect(r.attackerInitialFrontlineIds).toEqual(['i1', 'i2'])
  })

  it('infantry が frontage に満たなければ cavalry も frontline に出る', () => {
    const atk = [
      reg('i1', 'attacker', { effectivePower: 30 }),
      reg('c1', 'attacker', { troopKind: 'cavalry', effectivePower: 50 }),
      reg('c2', 'attacker', { troopKind: 'cavalry', effectivePower: 40 }),
    ]
    const r = simulateBattle(makeInput(atk, [reg('d1', 'defender')], { frontage: 3 }))
    expect(r.attackerInitialFrontlineIds).toHaveLength(3)
    expect(r.attackerInitialFrontlineIds).toContain('c1')
    expect(r.attackerInitialFrontlineIds).toContain('c2')
  })

  it('strength/org が閾値以下の連隊は deployment 外 (initial frontline に出ない)', () => {
    // org 15 (< retreatThreshold 20) は配置されない。
    const atk = [reg('a1', 'attacker', { organization: 15 }), reg('a2', 'attacker')]
    const r = simulateBattle(makeInput(atk, [reg('d1', 'defender')], { frontage: 5 }))
    expect(r.attackerInitialFrontlineIds).toEqual(['a2'])
  })
})

describe('simulateBattle rout (§11.1)', () => {
  it('低 morale + 劣勢で defender が rout し attacker_victory', () => {
    const atk = [reg('a1', 'attacker', { effectivePower: 100, basePower: 100 })]
    // defender: org 22 (>retreat 20), morale 1 → effRoute = 8 + (30-1)*0.25 = 15.25。
    //   1 tick で org が 15.25 以下に落ちて rout する。
    const def = [reg('d1', 'defender', { effectivePower: 10, organization: 22, morale: 1 })]
    const r = simulateBattle(makeInput(atk, def))
    expect(r.result).toBe('attacker_victory')
    expect(r.defenderRoutedRegimentIds).toContain('d1')
    expect(r.ticksElapsed).toBe(1)
  })
})

describe('simulateBattle 両端ケース (§8.2)', () => {
  it('defender 0 連隊 → attacker_victory auto-resolve (draw 無し / rng 不変)', () => {
    const inp = makeInput([reg('a1', 'attacker')], [])
    const r = simulateBattle(inp)
    expect(r.result).toBe('attacker_victory')
    expect(r.ticksElapsed).toBe(1)
    expect(r.rng).toEqual(inp.rng) // matchup 無し → draw なし
  })

  it('attacker 0 連隊 → defender_victory', () => {
    const r = simulateBattle(makeInput([], [reg('d1', 'defender')]))
    expect(r.result).toBe('defender_victory')
  })

  it('双方 0 連隊 → inconclusive (tiebreak 0 vs 0)', () => {
    const r = simulateBattle(makeInput([], []))
    expect(r.result).toBe('inconclusive')
  })

  it('frontage 1 でも成立する', () => {
    const r = simulateBattle(
      makeInput([reg('a1', 'attacker'), reg('a2', 'attacker')], [reg('d1', 'defender')], {
        frontage: 1,
      }),
    )
    expect(r.attackerInitialFrontlineIds).toHaveLength(1)
    expect(['attacker_victory', 'defender_victory', 'inconclusive']).toContain(r.result)
  })

  it('連隊あり → rng が進む', () => {
    const inp = makeInput([reg('a1', 'attacker')], [reg('d1', 'defender')])
    const r = simulateBattle(inp)
    expect(r.rng.state).not.toBe(inp.rng.state)
  })
})

describe('simulateBattle output 整合', () => {
  it('regimentResults は全入力連隊を含む', () => {
    const r = simulateBattle(
      makeInput([reg('a1', 'attacker'), reg('a2', 'attacker')], [reg('d1', 'defender')]),
    )
    const ids = r.regimentResults.map((rr) => rr.regimentId).sort()
    expect(ids).toEqual(['a1', 'a2', 'd1'])
  })

  it('ticksElapsed <= maxTicks', () => {
    const r = simulateBattle(
      makeInput([reg('a1', 'attacker')], [reg('d1', 'defender')], { maxTicks: 5 }),
    )
    expect(r.ticksElapsed).toBeLessThanOrEqual(5)
    expect(r.ticksElapsed).toBeGreaterThanOrEqual(1)
  })
})
