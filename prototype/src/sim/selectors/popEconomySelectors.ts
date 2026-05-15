import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId } from '../types/ids'
import type { PopGroupId } from '../types/ids'

// POP production formula:
// production = pop.size * config.productivityByClass[pop.class] * (pop.wealth / 100) * (province.countryControl / 100)
export function getPopProduction(
  state: WorldState,
  config: SimulationConfig,
  popId: PopGroupId,
): number {
  const pop = state.popGroups[popId]
  if (!pop) return 0

  const province = state.provinces[pop.provinceId]
  if (!province) return 0

  const productivity = config.productivityByClass[pop.class]
  return pop.size * productivity * (pop.wealth / 100) * (province.countryControl / 100)
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
  for (const popId of province.popGroupIds) {
    total += getPopProduction(state, config, popId)
  }
  return total
}

// Province tax base: getProvinceProduction(state, config, provinceId) * (province.houseControl / 100)
export function getProvinceTaxBase(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  return getProvinceProduction(state, config, provinceId) * (province.houseControl / 100)
}

// Province manpower base:
// sum over pops: pop.size * config.manpowerFactorByClass[pop.class] * (province.countryControl / 100)
export function getProvinceManpowerBase(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let total = 0
  for (const popId of province.popGroupIds) {
    const pop = state.popGroups[popId]
    if (!pop) continue
    const manpowerFactor = config.manpowerFactorByClass[pop.class]
    total += pop.size * manpowerFactor * (province.countryControl / 100)
  }
  return total
}
