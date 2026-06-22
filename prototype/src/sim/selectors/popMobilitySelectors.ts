import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, StateRegionId } from '../types/ids'
import type { PopType, PopStratum } from '../types/popGroup'
import { POP_STRATA, POP_TYPES, getPopStratum } from '../types/popGroup'
import type { HoldingPopTypeDemand } from '../types/popMobility'
import { getHoldingAllPopTypeCapacities } from './popSelectors'

// v0.57 §雇用細分化: holding 単位の PopType 雇用需要 read-model。
//   desired = PopType 雇用容量 (施設駆動のハード枠)。idealShare = stratum 内で正規化した容量比。
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

  // stratum 合計で正規化して idealShare を求める (移住 opportunity score 用)。
  const stratumTotal: Record<PopStratum, number> = { lower: 0, middle: 0, upper: 0 }
  for (const t of POP_TYPES) stratumTotal[getPopStratum(t)] += capByType[t] ?? 0

  const idealShareByType: Partial<Record<PopType, number>> = {}
  const desiredEmployedByType: Partial<Record<PopType, number>> = {}
  for (const t of POP_TYPES) {
    const cap = capByType[t] ?? 0
    desiredEmployedByType[t] = cap
    const st = stratumTotal[getPopStratum(t)]
    idealShareByType[t] = st > 0 ? cap / st : 0
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

// v0.56 §6.5: promotion/demotion の相対 gate 用。StateRegion × stratum・size 加重の wealth 分位。
//   該当 stratum の POP がいなければ undefined (その stratum では昇格/転落を発火させない)。
function weightedWealthQuantile(items: { wealth: number; size: number }[], q: number): number {
  const sorted = [...items].sort((a, b) => a.wealth - b.wealth)
  let total = 0
  for (const it of sorted) total += it.size
  const first = sorted[0]
  if (total <= 0) return first ? first.wealth : 0
  const threshold = q * total
  let cum = 0
  for (const it of sorted) {
    cum += it.size
    if (cum >= threshold) return it.wealth
  }
  const last = sorted[sorted.length - 1]
  return last ? last.wealth : 0
}

export function computeStratumWealthQuantiles(
  state: WorldState,
  stateRegionId: StateRegionId,
): Record<PopStratum, { p25: number; median: number; p75: number } | undefined> {
  const buckets: Record<PopStratum, { wealth: number; size: number }[]> = {
    lower: [],
    middle: [],
    upper: [],
  }
  const result: Record<PopStratum, { p25: number; median: number; p75: number } | undefined> = {
    lower: undefined,
    middle: undefined,
    upper: undefined,
  }

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
        buckets[p.class].push({ wealth: p.wealth, size: p.size })
      }
    }
  }

  for (const stratum of POP_STRATA) {
    const arr = buckets[stratum]
    if (arr.length === 0) continue
    result[stratum] = {
      p25: weightedWealthQuantile(arr, 0.25),
      median: weightedWealthQuantile(arr, 0.5),
      p75: weightedWealthQuantile(arr, 0.75),
    }
  }

  return result
}
