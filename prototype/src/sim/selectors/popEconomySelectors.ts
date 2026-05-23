import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, HoldingId } from '../types/ids'
import type { PopGroupId } from '../types/ids'
import { clamp } from '../utils/math'
import { getProvincePolityControlFromHoldings } from './landContractSelectors'

// POP production formula:
// production = pop.size * config.productivityByClass[pop.class] * config.occupationProductivityMultiplier[pop.occupation] * (pop.wealth / 100) * clamp(1 + holding.development / 200, 0.5, 1.5) * (holding.polityControl / 100)
export function getPopProduction(
  state: WorldState,
  config: SimulationConfig,
  popId: PopGroupId,
): number {
  const pop = state.popGroups[popId]
  if (!pop) return 0
  const holding = state.holdings[pop.holdingId]
  if (!holding) return 0
  const productivity = config.productivityByClass[pop.class]
  const holdingDevelopmentModifier = clamp(1 + holding.development / 200, 0.5, 1.5)
  return (
    pop.size *
    productivity *
    config.occupationProductivityMultiplier[pop.occupation] *
    (pop.wealth / 100) *
    holdingDevelopmentModifier *
    (holding.polityControl / 100)
  )
}

// Sum of all pop productions in a holding
export function getHoldingProduction(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const popIds = state.popIndex.byHolding[holdingId]
  if (!popIds) return 0
  let total = 0
  for (const popId of popIds) {
    total += getPopProduction(state, config, popId)
  }
  return total
}

// Sum of all pop productions in a province
export function getProvinceProduction(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let total = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      total += getPopProduction(state, config, popId)
    }
  }
  return total
}

// v0.16: houseControl 廃止により、Province の徴税ベースは polityControl に統一する。
export function getProvinceTaxBase(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const polityControl = getProvincePolityControlFromHoldings(state, provinceId)
  return getProvinceProduction(state, config, provinceId) * (polityControl / 100)
}

// Province country manpower base:
// sum over pops: pop.size * config.manpowerFactorByClass[pop.class] * config.occupationManpowerMultiplier[pop.occupation] * (holding.polityControl / 100)
export function getProvinceCountryManpowerBase(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let total = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    const polityControl = state.holdings[holdingId]?.polityControl ?? 0
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      const manpowerFactor = config.manpowerFactorByClass[pop.class]
      total +=
        pop.size *
        manpowerFactor *
        config.occupationManpowerMultiplier[pop.occupation] *
        (polityControl / 100)
    }
  }
  return total
}

// v0.16: houseControl 廃止により、house manpower も polityControl 基準。
// terminal Polity の ownerHouseId がいる場合、そのハウスが Province から徴募できる兵力。
export function getProvinceHouseManpowerBase(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  return getProvinceCountryManpowerBase(state, config, provinceId)
}

// Compatibility wrapper — delegates to getProvinceCountryManpowerBase
export function getProvinceManpowerBase(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  return getProvinceCountryManpowerBase(state, config, provinceId)
}
