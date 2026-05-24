import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, HoldingId } from '../types/ids'
import type { PopGroup, PopClass, PopOccupation } from '../types/popGroup'
import { clamp } from '../utils/math'
import { getHoldingDevelopmentModifier } from './holdingImprovementSelectors'

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

const CLASS_OCCUPATION_PAIRS: [PopClass, PopOccupation][] = [
  ['peasants', 'agriculture'],
  ['townsmen', 'urban_labor'],
  ['nobles', 'elite_service'],
]

export function getProvinceCarryingCapacity(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return config.minProvinceCarryingCapacity

  let totalCapacity = 0
  for (const holdingId of province.holdingIds) {
    for (const [popClass, occupation] of CLASS_OCCUPATION_PAIRS) {
      totalCapacity += getHoldingOccupationCapacity(state, config, holdingId, popClass, occupation)
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

// --- v0.24 Occupation capacity selectors ---

export function getHoldingPopsByClassAndOccupation(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  occupation: PopOccupation,
): PopGroup[] {
  return getHoldingPops(state, holdingId).filter(
    (p) => p.class === popClass && p.occupation === occupation,
  )
}

export function getHoldingPopSizeByClassAndOccupation(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  occupation: PopOccupation,
): number {
  return getHoldingPopsByClassAndOccupation(state, holdingId, popClass, occupation).reduce(
    (sum, p) => sum + p.size,
    0,
  )
}

export function getHoldingOccupationCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  _popClass: PopClass,
  occupation: PopOccupation,
): number {
  if (occupation === 'none') return 0
  const holding = state.holdings[holdingId]
  if (!holding) return 0
  const baseCapacity = config.occupationCapacityBaseByHoldingKind[holding.kind]?.[occupation]
  if (baseCapacity === undefined) return 0
  const developmentModifier = getHoldingDevelopmentModifier(state, config, holdingId)
  return baseCapacity * holding.weight * holding.landQuality * developmentModifier
}

export function getHoldingOccupationRemainingCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popClass: PopClass,
  occupation: PopOccupation,
): number {
  const capacity = getHoldingOccupationCapacity(state, config, holdingId, popClass, occupation)
  const used = getHoldingPopSizeByClassAndOccupation(state, holdingId, popClass, occupation)
  return Math.max(0, capacity - used)
}

export function getHoldingLaborShortage(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popClass: PopClass,
  occupation: PopOccupation,
): number {
  return getHoldingOccupationRemainingCapacity(state, config, holdingId, popClass, occupation)
}

export function getHoldingUnemployedPopSize(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  return getHoldingPopSizeByClassAndOccupation(state, holdingId, popClass, 'none')
}

export function getHoldingEmploymentRateByClass(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  const total = getHoldingPopSizeByClass(state, holdingId, popClass)
  if (total <= 0) return 1
  const unemployed = getHoldingUnemployedPopSize(state, holdingId, popClass)
  return clamp(1 - unemployed / total, 0, 1)
}
