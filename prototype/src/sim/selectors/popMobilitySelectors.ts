import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, StateRegionId, ProductionRecipeId } from '../types/ids'
import type { PopType, PopStratum } from '../types/popGroup'
import { POP_STRATA, POP_TYPES, POP_TYPES_BY_STRATUM } from '../types/popGroup'
import type { HoldingPopTypeDemand } from '../types/popMobility'
import { getHoldingClassCapacity } from './popSelectors'
import { RECIPE_LABOR_PROFILES } from '../config/productionRecipeDefinitions'

// v0.56 §6: holding 単位の PopType 雇用需要 read-model。
//   capacity は live (現在値)、idealShare は recipe 由来、current は employed POP 集計。
//   desired = stratum capacity × idealShare。shortage/surplus は転職・移住スコア用 (強制変換はしない)。
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

  // §6.3: holding の RealEstateAsset の recipeSlots から recipe 理想 weight を slot 加重で集約。
  const accumulatedWeight: Partial<Record<PopType, number>> = {}
  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  for (const aId of assetIds) {
    const asset = state.realEstateAssets[aId]
    if (!asset) continue
    for (const recipeId of Object.keys(asset.recipeSlots) as ProductionRecipeId[]) {
      const slots = asset.recipeSlots[recipeId] ?? 0
      if (slots <= 0) continue
      const profile = RECIPE_LABOR_PROFILES[recipeId]
      if (!profile) continue
      for (const d of profile) {
        accumulatedWeight[d.popType] = (accumulatedWeight[d.popType] ?? 0) + d.idealWeight * slots
      }
    }
  }

  // stratum ごとに idealShare を正規化し capacity を掛けて desired を求める。
  const idealShareByType: Partial<Record<PopType, number>> = {}
  const desiredEmployedByType: Partial<Record<PopType, number>> = {}
  for (const stratum of POP_STRATA) {
    const types = POP_TYPES_BY_STRATUM[stratum]
    const capacity = getHoldingClassCapacity(state, config, holdingId, stratum)
    let totalWeight = 0
    for (const t of types) totalWeight += accumulatedWeight[t] ?? 0

    if (totalWeight > 0) {
      for (const t of types) {
        const share = (accumulatedWeight[t] ?? 0) / totalWeight
        idealShareByType[t] = share
        desiredEmployedByType[t] = capacity * share
      }
    } else {
      // §6.3 fallback: recipe demand 無し → 既存 current 構成を維持。current も無ければ均等配分。
      let curTotal = 0
      for (const t of types) curTotal += currentEmployedByType[t] ?? 0
      if (curTotal > 0) {
        for (const t of types) {
          const share = (currentEmployedByType[t] ?? 0) / curTotal
          idealShareByType[t] = share
          desiredEmployedByType[t] = capacity * share
        }
      } else {
        const even = types.length > 0 ? 1 / types.length : 0
        for (const t of types) {
          idealShareByType[t] = even
          desiredEmployedByType[t] = capacity * even
        }
      }
    }
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
