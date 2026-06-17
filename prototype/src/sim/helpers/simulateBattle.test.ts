import { describe, it, expect } from 'vitest'
import { simulateBattle } from './simulateBattle'
import type { BattleSimInput, BattleSimRegimentInput } from './simulateBattle'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import type { RegimentId, BattleId, WarId, PersonId } from '../types/ids'
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

// v0.49: BattleSimCommanderInput を簡潔に作る (pursuit/command/insight/valor は fieldCommandScore 基準の既定)。
function cmd(
  personId: string,
  fieldCommandScore: number,
  breakthroughScore: number,
): import('./simulateBattle').BattleSimCommanderInput {
  return {
    personId: personId as PersonId,
    fieldCommandScore,
    breakthroughScore,
    pursuitScore: 50,
    command: 50,
    insight: 50,
    valor: 50,
  }
}

// v0.49: BattleSimCaptainGeneralInput を簡潔に作る (warCommand 指定、能力は中立 50)。
function cg(
  warCommand: number,
  overrides: Partial<import('./simulateBattle').BattleSimCaptainGeneralInput> = {},
): import('./simulateBattle').BattleSimCaptainGeneralInput {
  return {
    warCommand,
    command: 50,
    insight: 50,
    valor: 50,
    ambition: 0.5,
    caution: 0.5,
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

describe('simulateBattle commander / captainGeneral 効果 (§13.5 / §14, C1)', () => {
  // 1v1 / frontage 1 / maxTicks 1 で 1 回の damage 交換を取り出す。指揮官割当は draw を消費しないので
  //   同一 rng 下では「割当の有無」だけが乗算で効き、厳密な比率を検証できる。
  const orgDmgOf = (r: ReturnType<typeof simulateBattle>, id: string) =>
    r.regimentResults.find((rr) => rr.regimentId === id)!.organizationDamage

  function duel(overrides: Partial<BattleSimInput>): BattleSimInput {
    return makeInput([reg('a1', 'attacker')], [reg('d1', 'defender')], {
      frontage: 1,
      maxTicks: 1,
      ...overrides,
    })
  }

  it('(a) 空 pool / CG 未供給 → assignment 空・commander 効果なし (B2b 回帰)', () => {
    const r = simulateBattle(duel({}))
    expect(r.attackerCommanderAssignments).toEqual([])
    expect(r.defenderCommanderAssignments).toEqual([])
  })

  it('(b) 攻撃側 commander: 割当連隊は与 damage ×(1+q) / 被 damage ×(1-q)、bounded', () => {
    const base = simulateBattle(duel({}))
    const withCmd = simulateBattle(
      duel({
        attackerCommanders: [cmd('p1', 100, 50)],
      }),
    )
    // q = clamp((100-50)/50,-1,1) × commanderAssignedRegimentEffectMax(0.15) = 0.15。
    const q = defaultConfig.commanderAssignedRegimentEffectMax
    // v0.49 §9.3: base は a1 無指揮官 (与 damage ×(1-penalty))、withCmd は a1 直接指揮官 (penalty 解消 + ×(1+q))。
    const pen = defaultConfig.battleUncommandedDamagePenalty
    expect(withCmd.attackerCommanderAssignments).toEqual([
      { commanderPersonId: 'p1', regimentId: 'a1' },
    ])
    // 与 damage 増: defender (d1) が受ける org damage は ×(1+q)/(1-penalty) (commander 効果 + uncommanded 解消)。
    expect(orgDmgOf(withCmd, 'd1') / orgDmgOf(base, 'd1')).toBeCloseTo((1 + q) / (1 - pen), 5)
    // 被 damage 減: attacker (a1) が受ける org damage は ×(1-q) (d1 は両ケース無指揮官で dealing 不変)。
    expect(orgDmgOf(withCmd, 'a1') / orgDmgOf(base, 'a1')).toBeCloseTo(1 - q, 5)
    // bounded: 効果は effectMax 内。
    expect(q).toBeLessThanOrEqual(0.15)
  })

  it('(d) 序列 invariant: 直接指揮官 ≥ 隣接支援 ≥ 完全無指揮官 (与 damage、§9.2)', () => {
    // frontage 3。attacker 3 連隊 (slot0,1,2)、各々が def slot0,1,2 に frontal 攻撃。
    //   同 power は regimentId 昇順 → a0 が最初に中央 slot1 へ。指揮官 1 人は中央 (a0) に割当 →
    //   a0=直接、a1(slot0)/a2(slot2)=隣接支援。a0→d0(slot1)、a1→d1(slot0) が frontal pair。
    //   random factor を固定 (min=max=1) して slot 間で commander 効果のみを比較する。
    const fixedRng = { ...defaultConfig, battleRandomFactorMin: 1, battleRandomFactorMax: 1 }
    const mkAtk = () => [
      reg('a0', 'attacker', { effectivePower: 75 }),
      reg('a1', 'attacker', { effectivePower: 75 }),
      reg('a2', 'attacker', { effectivePower: 75 }),
    ]
    const mkDef = () => [
      reg('d0', 'defender', { effectivePower: 75 }),
      reg('d1', 'defender', { effectivePower: 75 }),
      reg('d2', 'defender', { effectivePower: 75 }),
    ]
    const withCmd = simulateBattle(
      makeInput(mkAtk(), mkDef(), {
        frontage: 3,
        maxTicks: 1,
        config: fixedRng,
        attackerCommanders: [cmd('p1', 100, 50)],
      }),
    )
    const directDmg = orgDmgOf(withCmd, 'd0') // a0 (直接指揮官, slot1) → d0
    const adjacentDmg = orgDmgOf(withCmd, 'd1') // a1 (隣接支援, slot0) → d1
    const noCmd = simulateBattle(
      makeInput(mkAtk(), mkDef(), { frontage: 3, maxTicks: 1, config: fixedRng }),
    )
    const uncommandedDmg = orgDmgOf(noCmd, 'd1') // 完全無指揮官 → d1
    // 直接 > 隣接支援 > 無指揮官 (与 damage)。
    expect(directDmg).toBeGreaterThan(adjacentDmg)
    expect(adjacentDmg).toBeGreaterThan(uncommandedDmg)
  })

  it('(c) 防御側 captainGeneral: 当該 side の被 org damage を最大 10% 軽減 (bounded)', () => {
    const base = simulateBattle(duel({}))
    const withCG = simulateBattle(duel({ defenderCaptainGeneral: cg(100) }))
    // cgReduction = clamp((100-50)/50,0,1) × captainGeneralBattleOrganizationDamageEffectMax(0.10) = 0.10。
    const red = defaultConfig.captainGeneralBattleOrganizationDamageEffectMax
    expect(orgDmgOf(withCG, 'd1') / orgDmgOf(base, 'd1')).toBeCloseTo(1 - red, 5)
    // attacker 側は無補正。
    expect(orgDmgOf(withCG, 'a1')).toBeCloseTo(orgDmgOf(base, 'a1'), 5)
    expect(red).toBeLessThanOrEqual(0.1)
  })
})

describe('simulateBattle slot invariant (v0.49 §21.A)', () => {
  it('initialFrontline は frontage を超えず重複しない (slot 会計)', () => {
    // 5 attacker、frontage 3 → ちょうど 3 連隊が初期 frontline、全 unique。
    const atk = [
      reg('a1', 'attacker', { effectivePower: 50 }),
      reg('a2', 'attacker', { effectivePower: 40 }),
      reg('a3', 'attacker', { effectivePower: 30 }),
      reg('a4', 'attacker', { effectivePower: 20 }),
      reg('a5', 'attacker', { effectivePower: 10 }),
    ]
    const r = simulateBattle(makeInput(atk, [reg('d1', 'defender')], { frontage: 3 }))
    expect(r.attackerInitialFrontlineIds).toHaveLength(3)
    expect(new Set(r.attackerInitialFrontlineIds).size).toBe(3) // 重複なし
    // 最強 3 連隊が frontline (a1,a2,a3)、a4/a5 は reserve。
    expect(new Set(r.attackerInitialFrontlineIds)).toEqual(new Set(['a1', 'a2', 'a3']))
  })

  it('全連隊が rout/retreat しても reserve 補充され連隊は二重在籍/消失しない', () => {
    // 多数の連隊で rout と補充が起きるシナリオ。regimentResults は全連隊をちょうど 1 回ずつ含む。
    const atk = Array.from({ length: 6 }, (_, i) =>
      reg(`a${i}`, 'attacker', { effectivePower: 100 - i }),
    )
    const def = Array.from({ length: 6 }, (_, i) =>
      reg(`d${i}`, 'defender', { effectivePower: 30, organization: 25, morale: 2 }),
    )
    const r = simulateBattle(makeInput(atk, def, { frontage: 3, maxTicks: 5 }))
    const ids = r.regimentResults.map((rr) => rr.regimentId).sort()
    const expected = [...atk, ...def].map((x) => x.regimentId).sort()
    expect(ids).toEqual(expected) // 全連隊ちょうど 1 回 (二重計上も消失もない)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('center-out 配置: 偶数 frontage は中線対称 (n=4 で最強が slot1)', () => {
    // frontage 4、4 連隊。centerOutSlotOrder(4)=[1,2,0,3] なので最強 a1→slot1。
    // initialFrontline は slot 昇順 = [slot0=a3, slot1=a1, slot2=a2, slot3=a4]。
    const atk = [
      reg('a1', 'attacker', { effectivePower: 40 }),
      reg('a2', 'attacker', { effectivePower: 30 }),
      reg('a3', 'attacker', { effectivePower: 20 }),
      reg('a4', 'attacker', { effectivePower: 10 }),
    ]
    const r = simulateBattle(makeInput(atk, [reg('d1', 'defender')], { frontage: 4 }))
    expect(r.attackerInitialFrontlineIds).toEqual(['a3', 'a1', 'a2', 'a4'])
  })
})

describe('simulateBattle slot-based flanking (v0.49 §7-8)', () => {
  const orgDmgOf = (r: ReturnType<typeof simulateBattle>, id: string) =>
    r.regimentResults.find((rr) => rr.regimentId === id)!.organizationDamage

  it('数的不利な側に flanking が集中する (正面 + 左右隣接で複数攻撃)', () => {
    // frontage 3。defender 1 (slot1 中央) vs attacker 3 (全 slot 占有)。
    //   def slot1 は atk slot1 から正面、atk slot0/slot2 から flanking を受ける → 3 攻撃集中。
    const baseInput = makeInput([reg('a1', 'attacker')], [reg('d1', 'defender')], {
      frontage: 3,
      maxTicks: 1,
    })
    const base = simulateBattle(baseInput)
    const flanked = simulateBattle(
      makeInput(
        [reg('a1', 'attacker'), reg('a2', 'attacker'), reg('a3', 'attacker')],
        [reg('d1', 'defender')],
        { frontage: 3, maxTicks: 1 },
      ),
    )
    // 1 攻撃 (正面のみ) に対し、3 攻撃 (正面+flanking×2) を受けるので org damage は大幅増 (>2×)。
    expect(orgDmgOf(flanked, 'd1')).toBeGreaterThan(orgDmgOf(base, 'd1') * 2)
  })

  it('正面に敵がいれば flanking せず frontal を選ぶ (両側占有時は frontal)', () => {
    // frontage 3 で両側 3 連隊 → 全 slot で frontal pair。flanking は発生しない。
    const atk = [reg('a0', 'attacker'), reg('a1', 'attacker'), reg('a2', 'attacker')]
    const def = [reg('d0', 'defender'), reg('d1', 'defender'), reg('d2', 'defender')]
    const r = simulateBattle(makeInput(atk, def, { frontage: 3, maxTicks: 1 }))
    // 全連隊が同程度の frontal damage を受ける (flanking 集中なし)。中央 slot1 が突出しない。
    const d0 = orgDmgOf(r, 'd0')
    const d1 = orgDmgOf(r, 'd1')
    const d2 = orgDmgOf(r, 'd2')
    // frontal のみなら各 1 攻撃。flanking 集中があれば中央が突出するが、ここでは無いので近い値。
    expect(Math.max(d0, d1, d2) / Math.min(d0, d1, d2)).toBeLessThan(1.6) // random factor 範囲内
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
