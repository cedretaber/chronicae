// v0.49 §10 戦術 (三すくみ) 選択の純粋 helper。simulateBattle の battle tick ごとに呼ばれる。
//   決定性: §18.2 step1 の draw 順 (attacker → defender) を守る。draw は side ごと 1 回ずつ消費。

import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'
import type { BattleTactic } from '../types/battleLog'
import type { WarSideKey } from '../types/war'
import { clamp } from '../utils/math'

const TACTICS: readonly BattleTactic[] = ['offensive', 'defensive', 'disruption']

// §10.2 三すくみ: 攻勢 > 攪乱、攪乱 > 守勢、守勢 > 攻勢。
function beats(a: BattleTactic, b: BattleTactic): boolean {
  return (
    (a === 'offensive' && b === 'disruption') ||
    (a === 'disruption' && b === 'defensive') ||
    (a === 'defensive' && b === 'offensive')
  )
}

// t を破る (t に勝つ) 戦術。
function counterTo(t: BattleTactic): BattleTactic {
  if (t === 'offensive') return 'defensive'
  if (t === 'disruption') return 'offensive'
  return 'disruption' // defensive を破るのは攪乱
}

function pickUniform(value: number): BattleTactic {
  const idx = Math.floor(value * 3)
  return TACTICS[idx] ?? 'offensive' // value→1 の境界 guard
}

export type TacticSelection = {
  attackerTactic: BattleTactic
  defenderTactic: BattleTactic
  advantageSide: WarSideKey | undefined
  rng: RngState
}

// 両軍総大将の tactic を選ぶ。§10.3: 各 side は「base 傾向」を持ち、相手の base 傾向を読めれば
//   counter に切り替える。読み成功率は insight 差で base 1/3 から増減する (対称: insight が高い側ほど
//   相手を読んで有利戦術を選びやすい)。insight 同値なら双方 1/3 で読む → 公平 (net 優位なし)。
//   draw 順 (§18.2 step1。attacker → defender): attackerBase, attackerReadRoll, defenderBase, defenderReadRoll。
export function selectTactics(
  attackerInsight: number,
  defenderInsight: number,
  insightReadEffect: number,
  rng: RngState,
): TacticSelection {
  const d1 = randomFloat(rng)
  const attackerBase = pickUniform(d1.value)
  const d2 = randomFloat(d1.rng)
  const attackerReadRoll = d2.value
  const d3 = randomFloat(d2.rng)
  const defenderBase = pickUniform(d3.value)
  const d4 = randomFloat(d3.rng)
  const defenderReadRoll = d4.value

  const readChance = (ownInsight: number, enemyInsight: number): number =>
    clamp(1 / 3 + ((ownInsight - enemyInsight) / 120) * insightReadEffect, 0, 0.95)
  const attackerReads = attackerReadRoll < readChance(attackerInsight, defenderInsight)
  const defenderReads = defenderReadRoll < readChance(defenderInsight, attackerInsight)

  // 相手の base 傾向を読めたら counter に切替、読めなければ自分の base を出す。
  const attackerTactic = attackerReads ? counterTo(defenderBase) : attackerBase
  const defenderTactic = defenderReads ? counterTo(attackerBase) : defenderBase

  let advantageSide: WarSideKey | undefined
  if (beats(attackerTactic, defenderTactic)) advantageSide = 'attacker'
  else if (beats(defenderTactic, attackerTactic)) advantageSide = 'defender'
  return { attackerTactic, defenderTactic, advantageSide, rng: d4.rng }
}
