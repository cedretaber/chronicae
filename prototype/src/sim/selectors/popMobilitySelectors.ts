import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, StateRegionId } from '../types/ids'
import type { PopType } from '../types/popGroup'
import { POP_TYPES } from '../types/popGroup'
import type { HoldingPopTypeDemand } from '../types/popMobility'
import { getHoldingAllPopTypeCapacities } from './popSelectors'

// v0.57 §雇用細分化: holding 単位の PopType 雇用需要 read-model。
//   desired = PopType 雇用容量 (施設駆動のハード枠)。idealShare = holding 全体で正規化した容量比
//   (v0.57.1: stratum 内正規化から holding 全体へ。移動の判断を Class 単位に統一)。
//   current は employed POP 集計。shortage/surplus は転職・移住スコア・rebalance 順序付け用。
export function computeHoldingPopTypeDemand(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): HoldingPopTypeDemand {
  // current: holding の employed POP を popType 別に集計。
  const currentEmployedByType: Partial<Record<PopType, number>> = {}
  const popIds = state.popIndex.byHolding[holdingId] ?? []
  for (const pid of popIds) {
    const p = state.popGroups[pid]
    if (!p || !p.employed) continue
    currentEmployedByType[p.popType] = (currentEmployedByType[p.popType] ?? 0) + p.size
  }

  // desired = 施設駆動の PopType 雇用容量 (1 パス計算)。
  const capByType = getHoldingAllPopTypeCapacities(state, config, holdingId)

  // holding 全体の容量合計で正規化して idealShare を求める (移住 opportunity score 用)。
  let totalCap = 0
  for (const t of POP_TYPES) totalCap += capByType[t] ?? 0

  const idealShareByType: Partial<Record<PopType, number>> = {}
  const desiredEmployedByType: Partial<Record<PopType, number>> = {}
  for (const t of POP_TYPES) {
    const cap = capByType[t] ?? 0
    desiredEmployedByType[t] = cap
    idealShareByType[t] = totalCap > 0 ? cap / totalCap : 0
  }

  // §6.4: shortage / surplus。
  const shortageByType: Partial<Record<PopType, number>> = {}
  const surplusByType: Partial<Record<PopType, number>> = {}
  for (const t of POP_TYPES) {
    const desired = desiredEmployedByType[t] ?? 0
    const current = currentEmployedByType[t] ?? 0
    const shortage = Math.max(0, desired - current)
    const surplus = Math.max(0, current - desired)
    if (shortage > 0) shortageByType[t] = shortage
    if (surplus > 0) surplusByType[t] = surplus
  }

  return {
    holdingId,
    idealShareByType,
    desiredEmployedByType,
    currentEmployedByType,
    shortageByType,
    surplusByType,
  }
}

// v0.56 §6.5 / v0.57.1 / v0.58: promotion/demotion の相対 gate 用。StateRegion × **PopType**・size 加重の
//   **per-capita money (money/size)** 分位。v0.58 で wealth 指数から per-capita money へ移行
//   (extensive total では大集団が常に上位になるため per-capita で比較する)。
//   比較母集団は「同じ職能」(移動の判断を Class 単位に統一)。
//   該当 PopType の POP がいなければ undefined (その職能では昇格/転落を発火させない)。
function weightedMoneyQuantile(items: { perCapMoney: number; size: number }[], q: number): number {
  const sorted = [...items].sort((a, b) => a.perCapMoney - b.perCapMoney)
  let total = 0
  for (const it of sorted) total += it.size
  const first = sorted[0]
  if (total <= 0) return first ? first.perCapMoney : 0
  const threshold = q * total
  let cum = 0
  for (const it of sorted) {
    cum += it.size
    if (cum >= threshold) return it.perCapMoney
  }
  const last = sorted[sorted.length - 1]
  return last ? last.perCapMoney : 0
}

export function computePopTypeMoneyQuantiles(
  state: WorldState,
  stateRegionId: StateRegionId,
): Partial<Record<PopType, { p25: number; median: number; p75: number }>> {
  const buckets = new Map<PopType, { perCapMoney: number; size: number }[]>()
  const result: Partial<Record<PopType, { p25: number; median: number; p75: number }>> = {}

  const region = state.states[stateRegionId]
  if (!region) return result

  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const holdingId of province.holdingIds) {
      const popIds = state.popIndex.byHolding[holdingId] ?? []
      for (const pid of popIds) {
        const p = state.popGroups[pid]
        if (!p) continue
        const perCapMoney = p.size > 0 ? p.money / p.size : 0
        const arr = buckets.get(p.popType)
        if (arr) arr.push({ perCapMoney, size: p.size })
        else buckets.set(p.popType, [{ perCapMoney, size: p.size }])
      }
    }
  }

  for (const popType of POP_TYPES) {
    const arr = buckets.get(popType)
    if (!arr || arr.length === 0) continue
    result[popType] = {
      p25: weightedMoneyQuantile(arr, 0.25),
      median: weightedMoneyQuantile(arr, 0.5),
      p75: weightedMoneyQuantile(arr, 0.75),
    }
  }

  return result
}
