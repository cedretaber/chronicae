import type { SimulationConfig } from '../config/defaultConfig'
import type { PopGroup } from '../types/popGroup'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import { clamp } from '../utils/math'

// v0.54 §6 価格計算: price = basePrice * clamp(rawRatio ** elasticity, min, max)。
//   rawRatio = effectiveDemand / max(supply, epsilon)。在庫がないため unsold は消滅する。
export function computeResourcePrice(
  resource: ResourceKind,
  supply: number,
  effectiveDemand: number,
  config: SimulationConfig,
): number {
  const def = RESOURCE_PRICE_DEFINITIONS[resource]
  const rawRatio = effectiveDemand / Math.max(supply, config.resourceMarketSupplyEpsilon)
  const priceMultiplier = clamp(rawRatio ** def.elasticity, def.minMultiplier, def.maxMultiplier)
  return def.basePrice * priceMultiplier
}

// v0.54 §15.3 購買力係数: wealth 0/50/100 の係数を 2 区間線形補間する。raw_materials は POP 需要を持たない。
export function getPopResourcePurchasingPowerFactor(
  pop: PopGroup,
  resource: ResourceKind,
  config: SimulationConfig,
): number {
  let at0: number
  let at50: number
  let at100: number
  if (resource === 'food') {
    at0 = config.foodPurchasingPowerFactorAtWealth0
    at50 = config.foodPurchasingPowerFactorAtWealth50
    at100 = config.foodPurchasingPowerFactorAtWealth100
  } else if (resource === 'processed_goods') {
    at0 = config.processedGoodsPurchasingPowerFactorAtWealth0
    at50 = config.processedGoodsPurchasingPowerFactorAtWealth50
    at100 = config.processedGoodsPurchasingPowerFactorAtWealth100
  } else {
    return 0
  }
  const w = clamp(pop.wealth, 0, 100)
  if (w <= 50) return at0 + (at50 - at0) * (w / 50)
  return at50 + (at100 - at50) * ((w - 50) / 50)
}

// v0.54 §15: POP の resource 需要 (effectiveDemand)。size × class 別需要係数 × 購買力係数。
export function getPopResourceDemand(
  pop: PopGroup,
  resource: ResourceKind,
  config: SimulationConfig,
): number {
  let perSize: number
  if (resource === 'food') {
    perSize = config.popFoodDemandPerSizeByClass[pop.class]
  } else if (resource === 'processed_goods') {
    perSize = config.popProcessedGoodsDemandPerSizeByClass[pop.class]
  } else {
    return 0
  }
  const ppFactor = getPopResourcePurchasingPowerFactor(pop, resource, config)
  return pop.size * perSize * ppFactor
}
