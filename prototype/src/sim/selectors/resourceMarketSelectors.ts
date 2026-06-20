import type { SimulationConfig } from '../config/defaultConfig'
import type { PopGroup } from '../types/popGroup'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import { clamp } from '../utils/math'

// v0.54 市場清算 rewrite (§6.3c.1) 価格計算 (imbalance ベース):
//   imbalance = (buyOrders − sellOrders) / max(min(buyOrders, sellOrders), ε)
//   price = basePrice × (1 + marketPriceSwing × clamp(imbalance, −1, 1))
//   buy=0 / sell=0 は式 (min で割る) に入れず明示分岐で扱う。
export function computeResourcePrice(
  resource: ResourceKind,
  sellOrders: number,
  buyOrders: number,
  config: SimulationConfig,
): number {
  const def = RESOURCE_PRICE_DEFINITIONS[resource]
  const swing = config.marketPriceSwing
  // エッジケース (§6.3c.1)。
  if (buyOrders <= 0 && sellOrders <= 0) return def.basePrice
  if (buyOrders <= 0) return def.basePrice * (1 - swing) // 需要ゼロ: 下限価格で全量売れた扱い
  if (sellOrders <= 0) return def.basePrice * (1 + swing) // 供給ゼロ: 上限価格
  const imbalance =
    (buyOrders - sellOrders) /
    Math.max(Math.min(buyOrders, sellOrders), config.resourceMarketSupplyEpsilon)
  const priceMultiplier = 1 + swing * clamp(imbalance, -1, 1)
  return def.basePrice * priceMultiplier
}

// v0.54 市場清算 rewrite (§6.3c.1) 充足率・shortage:
//   fulfillmentRatio = buyOrders≤0 ? 1 : clamp(sellOrders/buyOrders, 0, 1)
//   shortage = buyOrders>0 && fulfillmentRatio < threshold
//   shortageSeverity = shortage ? clamp((threshold − fulfillmentRatio)/threshold, 0, 1) : 0
export function computeMarketFulfillment(
  sellOrders: number,
  buyOrders: number,
  config: SimulationConfig,
): { fulfillmentRatio: number; shortage: boolean; shortageSeverity: number } {
  const fulfillmentRatio = buyOrders <= 0 ? 1 : clamp(sellOrders / buyOrders, 0, 1)
  const threshold = config.resourceShortageFulfillmentThreshold
  const shortage = buyOrders > 0 && fulfillmentRatio < threshold
  const shortageSeverity = shortage ? clamp((threshold - fulfillmentRatio) / threshold, 0, 1) : 0
  return { fulfillmentRatio, shortage, shortageSeverity }
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
