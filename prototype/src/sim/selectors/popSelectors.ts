import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, HoldingId, StateRegionId } from '../types/ids'
import type { PopGroup, PopClass } from '../types/popGroup'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { RealEstateKind } from '../types/realEstateAsset'
import type { ResourceKind } from '../types/resource'
import { clamp } from '../utils/math'
import { FOOD_RESOURCE_VALUE } from '../config/popFoodDefinitions'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import {
  computeHoldingClassCapacity,
  computeSlotOveruseModifier,
} from './holdingImprovementSelectors'

// Returns all PopGroups for a province (empty array if none)
export function getProvincePops(state: WorldState, provinceId: ProvinceId): PopGroup[] {
  const province = state.provinces[provinceId]
  if (!province) return []

  const result: PopGroup[] = []
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      result.push(pop)
    }
  }
  return result
}

// Returns total population size for a province
export function getProvincePopulation(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let total = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      total += pop.size
    }
  }
  return total
}

// Returns the weighted average wealth of all POPs in a province (0 if no pops)
export function getProvinceAveragePopWealth(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let weightedSum = 0
  let totalPopulation = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      weightedSum += pop.wealth * pop.size
      totalPopulation += pop.size
    }
  }
  if (totalPopulation === 0) return 0
  return weightedSum / totalPopulation
}

const POP_CLASSES: PopClass[] = ['lower', 'middle', 'upper']

// v0.55 POP 再設計: state (= 食料市場) の食料供給。直近 clearing の food 資源 sellOrders × food value 合計。
export function getStateFoodSupply(state: WorldState, stateId: StateRegionId): number {
  let total = 0
  for (const [resource, value] of Object.entries(FOOD_RESOURCE_VALUE) as [ResourceKind, number][]) {
    const ps = state.marketResourcePrices[marketResourcePriceKey(stateId, resource)]
    if (!ps) continue
    const last = ps.history[ps.history.length - 1]
    if (!last) continue
    total += last.sellOrders * value
  }
  return total
}

// v0.55 POP 再設計: state の「養える人口」= max(floor, foodSupply / perCapitaFoodNeed)。
export function getStateCarryingCapacity(
  state: WorldState,
  config: SimulationConfig,
  stateId: StateRegionId,
): number {
  const supply = getStateFoodSupply(state, stateId)
  const cc = supply / Math.max(config.perCapitaFoodNeed, 0.0001)
  return Math.max(config.minProvinceCarryingCapacity, cc)
}

export function getStatePopulation(state: WorldState, stateId: StateRegionId): number {
  const region = state.states[stateId]
  if (!region) return 0
  let total = 0
  for (const provinceId of region.provinceIds) {
    total += getProvincePopulation(state, provinceId)
  }
  return total
}

// v0.55 POP 再設計: carrying capacity は食料市場 (state 単位) ベース。同一 state の全 province が共有する。
export function getProvinceCarryingCapacity(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return config.minProvinceCarryingCapacity
  return getStateCarryingCapacity(state, config, province.stateId)
}

// Returns population pressure: state 人口 / state 食料 carrying capacity (clamped 0..2)。
//   食料市場は state 単位のため、同一 state の全 province は同じ食料 pressure を共有する。
export function getProvincePopulationPressure(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  const capacity = getStateCarryingCapacity(state, config, province.stateId)
  if (capacity === 0) return 0
  return clamp(getStatePopulation(state, province.stateId) / capacity, 0, 2)
}

// Returns weighted average unrest across all POPs in a province (0 if no pops)
export function getProvinceUnrest(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let weightedSum = 0
  let totalPopulation = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      weightedSum += pop.unrest * pop.size
      totalPopulation += pop.size
    }
  }
  if (totalPopulation === 0) return 0
  return weightedSum / totalPopulation
}

// Returns the weighted average unrest of all POPs with the given class in the province
export function getPopUnrestByClass(
  state: WorldState,
  provinceId: ProvinceId,
  popClass: PopClass,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let weightedSum = 0
  let totalSize = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop || pop.class !== popClass) continue
      weightedSum += pop.unrest * pop.size
      totalSize += pop.size
    }
  }
  return totalSize > 0 ? weightedSum / totalSize : 0
}

// Returns the weighted average wealth of all POPs with the given class in the province
export function getPopWealthByClass(
  state: WorldState,
  provinceId: ProvinceId,
  popClass: PopClass,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let weightedSum = 0
  let totalSize = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop || pop.class !== popClass) continue
      weightedSum += pop.wealth * pop.size
      totalSize += pop.size
    }
  }
  return totalSize > 0 ? weightedSum / totalSize : 0
}

// --- Holding POP selectors ---

export function getHoldingPops(state: WorldState, holdingId: HoldingId): PopGroup[] {
  const popIds = state.popIndex.byHolding[holdingId]
  if (!popIds) return []
  const result: PopGroup[] = []
  for (const popId of popIds) {
    const pop = state.popGroups[popId]
    if (pop) result.push(pop)
  }
  return result
}

function getHoldingPopsByClass(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): PopGroup[] {
  return getHoldingPops(state, holdingId).filter((p) => p.class === popClass)
}

export function getHoldingPopSizeByClass(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  return getHoldingPopsByClass(state, holdingId, popClass).reduce((sum, p) => sum + p.size, 0)
}

export function getHoldingPopsByClassAndEmployment(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  employed: boolean,
): PopGroup[] {
  return getHoldingPops(state, holdingId).filter(
    (p) => p.class === popClass && p.employed === employed,
  )
}

export function getHoldingEmployedPopSize(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  return getHoldingPopsByClassAndEmployment(state, holdingId, popClass, true).reduce(
    (sum, p) => sum + p.size,
    0,
  )
}

export function getHoldingUnemployedPopSize(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  return getHoldingPopsByClassAndEmployment(state, holdingId, popClass, false).reduce(
    (sum, p) => sum + p.size,
    0,
  )
}

export function getHoldingClassCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  const holding = state.holdings[holdingId]
  if (!holding) return 0
  const province = state.provinces[holding.provinceId]
  if (!province) return 0

  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string] ?? []
  const improvements: { kind: HoldingImprovementKind; level: number; condition: number }[] = []
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (imp) improvements.push({ kind: imp.kind, level: imp.level, condition: imp.condition })
  }

  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  const assets: { realEstateKind: RealEstateKind; level: number }[] = []
  for (const aId of assetIds) {
    const asset = state.realEstateAssets[aId]
    if (asset) assets.push({ realEstateKind: asset.realEstateKind, level: asset.level })
  }

  const usedSlots = assets.length
  const slotCap = config.realEstateSlotCapacityBase[holding.kind] ?? 3
  const overuseMod = computeSlotOveruseModifier(usedSlots, slotCap, config)

  return computeHoldingClassCapacity(
    holding.kind,
    holding.weight,
    holding.landQuality,
    province.terrain,
    province.features,
    improvements,
    config,
    popClass,
    assets,
    overuseMod,
  )
}

export function getHoldingClassRemainingCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  const capacity = getHoldingClassCapacity(state, config, holdingId, popClass)
  const used = getHoldingEmployedPopSize(state, holdingId, popClass)
  return Math.max(0, capacity - used)
}

export function hasCapacityPressure(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): boolean {
  for (const pc of POP_CLASSES) {
    const cap = getHoldingClassCapacity(state, config, holdingId, pc)
    if (cap <= 0) continue
    const employed = getHoldingEmployedPopSize(state, holdingId, pc)
    if (employed / cap >= config.developRealEstateCapacityPressureThreshold) return true
  }
  return false
}

// v0.55 §B: holding 内のいずれかのクラスで失業 POP が閾値以上いるか。
//   capacity pressure (既存施設の満員度) と独立した拡張トリガで、idle labor を新規開発/レベルアップで
//   雇用に変えられる状況を捉える。失業者がいると employed/cap はむしろ低く、capacity pressure では
//   検出できない (意図と逆) ためのシグナル。pure read・RNG 不使用。
export function hasEmploymentSlack(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): boolean {
  for (const pc of POP_CLASSES) {
    if (
      getHoldingUnemployedPopSize(state, holdingId, pc) >=
      config.developRealEstateEmploymentSlackThreshold
    )
      return true
  }
  return false
}
