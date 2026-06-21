import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, HoldingId } from '../types/ids'
import type { PopGroup, PopClass } from '../types/popGroup'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { RealEstateKind } from '../types/realEstateAsset'
import { clamp } from '../utils/math'
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

export function getProvinceCarryingCapacity(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return config.minProvinceCarryingCapacity

  let totalCapacity = 0
  for (const holdingId of province.holdingIds) {
    for (const popClass of POP_CLASSES) {
      totalCapacity += getHoldingClassCapacity(state, config, holdingId, popClass)
    }
  }
  return Math.max(config.minProvinceCarryingCapacity, totalCapacity)
}

// Returns population pressure: population / carryingCapacity (clamped to 0..2)
export function getProvincePopulationPressure(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const capacity = getProvinceCarryingCapacity(state, config, provinceId)
  if (capacity === 0) return 0

  const population = getProvincePopulation(state, provinceId)
  return clamp(population / capacity, 0, 2)
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
