import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, HoldingId } from '../types/ids'
import type { PopGroup } from '../types/popGroup'
import type { PopClass } from '../types/popGroup'
import { clamp } from '../utils/math'
import { getProvinceDevelopmentFromHoldings } from './landContractSelectors'

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

// Returns carrying capacity: max(minProvinceCarryingCapacity, habitability * populationCapacityPerHabitability * devMod)
// devMod = clamp(1 + development/200, 0.5, 1.5)
export function getProvinceCarryingCapacity(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return config.minProvinceCarryingCapacity

  const development = getProvinceDevelopmentFromHoldings(state, provinceId)
  const devMod = clamp(1 + development / 200, 0.5, 1.5)
  const capacity = province.habitability * config.populationCapacityPerHabitability * devMod
  return Math.max(config.minProvinceCarryingCapacity, capacity)
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

export function getHoldingPopsByClass(
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
