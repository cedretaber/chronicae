import { describe, it, expect } from 'vitest'
import { selectTactics } from './battleTactics'
import { createRng } from '../rng/rng'

// v0.49 §10 戦術選択の単体テスト。決定性 / 三すくみの公平性 / insight 読みの優位。

describe('selectTactics determinism', () => {
  it('同一 insight + 同一 rng → 同一結果', () => {
    const rng = createRng('tactic-test')
    const a = selectTactics(60, 40, 0.5, rng)
    const b = selectTactics(60, 40, 0.5, rng)
    expect(b.attackerTactic).toBe(a.attackerTactic)
    expect(b.defenderTactic).toBe(a.defenderTactic)
    expect(b.advantageSide).toBe(a.advantageSide)
    expect(b.rng).toEqual(a.rng)
  })

  it('draw を消費する (attacker → defender 順)', () => {
    const rng = createRng('tactic-draw')
    const r = selectTactics(50, 50, 0.5, rng)
    expect(r.rng.state).not.toBe(rng.state)
  })
})

describe('selectTactics 三すくみの公平性 / insight 優位', () => {
  // 多数 seed で advantageSide の分布を集計するヘルパー。
  function tally(atkInsight: number, defInsight: number, n: number) {
    let atk = 0
    let def = 0
    let none = 0
    for (let i = 0; i < n; i++) {
      const r = selectTactics(atkInsight, defInsight, 0.5, createRng('seed-' + i))
      if (r.advantageSide === 'attacker') atk++
      else if (r.advantageSide === 'defender') def++
      else none++
    }
    return { atk, def, none }
  }

  it('insight 同値なら attacker/defender の優位回数はほぼ拮抗 (公平)', () => {
    const { atk, def } = tally(50, 50, 600)
    // 完全公平ではないが、どちらかに極端には偏らない (比率 0.7〜1.4 程度)。
    const ratio = atk / Math.max(1, def)
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(1.6)
  })

  it('defender insight が高いと defender の戦術優位が上回る (相手を読む)', () => {
    const { atk, def } = tally(20, 110, 600)
    expect(def).toBeGreaterThan(atk)
  })

  it('attacker insight が高いと attacker の戦術優位が上回る', () => {
    const { atk, def } = tally(110, 20, 600)
    expect(atk).toBeGreaterThan(def)
  })
})
