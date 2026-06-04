// v0.42 §6 開戦前の勝率推定。
//
// 過去の「推定 ≠ 実態で全滅」バグ (war開始時 attacker=0 の95%が全滅) を避けるため、
// 推定戦力は実戦闘 (getRegimentPowerForWarSide / regimentSelectors.ts) と同じ戦力源で算出する:
//   - 動員可能な常設連隊 (active かつ currentWarId===undefined) の effectivePower 合計
//   - 連隊記録がゼロのとき (記録未生成 = house participant 等) のみ nominal power フォールバック
//   - 記録はあるが全員別戦争/全滅 → 0 (動員できる兵がいない)
//
// mobilizable の filter 条件は mobilizeRegimentsForWar (regimentMutations.ts) と完全一致させる。
// この一致が崩れると「推定では勝てるのに実戦では動員ゼロ」が再発する。
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { OrganizationRef } from '../types/office'
import { politicalActorKey, getActorMilitaryPower } from './actorSelectors'
import { getRegimentEffectivePower } from './regimentSelectors'

// 開戦判断側の戦力推定。getRegimentPowerForWarSide は byWar キーで動員済み連隊を見る別物なので
// 強制共有はせず、「getRegimentEffectivePower の合計」と「記録ゼロ時のみ nominal」規則だけを共有する。
export function estimateWarSidePower(
  state: WorldState,
  config: SimulationConfig,
  actor: OrganizationRef,
): number {
  const ids = state.regimentIndex.byOwner[politicalActorKey(actor)] ?? []
  if (ids.length === 0) {
    // 連隊記録が無い参加者は §10.4(a) と同じく nominal power にフォールバック。
    return getActorMilitaryPower(state, config, actor)
  }
  let total = 0
  for (const id of ids) {
    const r = state.regiments[id]
    // mobilizeRegimentsForWar と同一条件: active かつ未動員。
    if (!r || r.status !== 'active' || r.currentWarId !== undefined) continue
    total += getRegimentEffectivePower(r)
  }
  // 記録はあるが動員可能ゼロ (全員別戦争 / 全滅) → 0。勝率 0 で開戦を退ける (全滅バグも塞ぐ)。
  return total
}

// 攻撃側の勝率近似 = atk / (atk + def)。warScore の edgeWeight が実優位をクランプするため
// これは単調近似で十分 (厳密な勝敗確率ではなく開戦しきい値との比較にのみ使う)。
export function estimateAttackerWinChance(
  state: WorldState,
  config: SimulationConfig,
  attacker: OrganizationRef,
  defender: OrganizationRef,
): number {
  const atk = estimateWarSidePower(state, config, attacker)
  const def = estimateWarSidePower(state, config, defender)
  if (atk <= 0) return 0
  if (def <= 0) return 1
  return atk / (atk + def)
}
