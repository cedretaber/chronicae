import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId } from '../types/ids'
import { isEmployed } from '../types/workplaceRef'

// v0.54: 旧 POP 直接 production (getPopProduction / getHoldingProduction / getProvinceProduction) は
//   資源経済へ置換され削除。holding/province の月次 revenue は resourceRevenueSelectors を参照。
//   manpower 系は POP production とは独立 (pop を直接走査) のため本ファイルに残す。

// Province country manpower base:
// sum over pops: pop.size * manpowerFactor * manpowerMultiplier * (polityControl / 100)
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
      const mpMult = isEmployed(pop)
        ? config.employedManpowerMultiplierByClass[pop.class]
        : config.unemployedManpowerMultiplier
      total += pop.size * manpowerFactor * mpMult * (polityControl / 100)
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
