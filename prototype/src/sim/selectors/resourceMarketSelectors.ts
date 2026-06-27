import type { SimulationConfig } from '../config/defaultConfig'
import type { PopGroup } from '../types/popGroup'
import type { ResourceKind } from '../types/resource'
import type { NeedCategory, NeedTier } from '../types/needCategory'
import {
  NEED_CATEGORIES,
  getNeedCategoryTier,
  NEED_CATEGORY_CONTRIBUTIONS,
} from '../types/needCategory'
import { POP_NEED_PROFILES } from '../config/popNeedDefinitions'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import { resolveCategoryShares } from './resourceChoiceSelectors'
import { clamp } from '../utils/math'

// v0.54 市場清算 rewrite (§6.3c.1) 価格計算 (非対称 imbalance ベース):
//   imbalance = (buyOrders − sellOrders) / max(min(buyOrders, sellOrders), ε)
//   不足時 (imbalance > 0): effectiveSwing = marketPriceSwing × priceSwingMultiplier（非弾力品は急騰）
//   余剰時 (imbalance < 0): effectiveSwing = marketPriceSwing（全品目共通の穏やかな下落）
//   price = basePrice × (1 + effectiveSwing × clamp(imbalance, −1, 1))
export function computeResourcePrice(
  resource: ResourceKind,
  sellOrders: number,
  buyOrders: number,
  config: SimulationConfig,
): number {
  const def = RESOURCE_PRICE_DEFINITIONS[resource]
  const baseSwing = config.marketPriceSwing
  const upSwing = baseSwing * def.priceSwingMultiplier
  if (buyOrders <= 0 && sellOrders <= 0) return def.basePrice
  if (buyOrders <= 0) return def.basePrice * (1 - baseSwing)
  if (sellOrders <= 0) return def.basePrice * (1 + upSwing)
  const imbalance =
    (buyOrders - sellOrders) /
    Math.max(Math.min(buyOrders, sellOrders), config.resourceMarketSupplyEpsilon)
  const clamped = clamp(imbalance, -1, 1)
  const effectiveSwing = clamped >= 0 ? upSwing : baseSwing
  return def.basePrice * (1 + effectiveSwing * clamped)
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

// §5.4 / §15.3: POP の NeedCategory 別需要を ResourceKind buyOrders へ解決する。
//   v0.58: desiredValue = amountPerPop × size の **full desired**（購買力補正は廃止）。
//   予算制約は呼び出し側（resourceEconomySystem の tier 優先配分）が start-of-tick money で担う。
//   buyOrders_i (資源単位) = share_i × desiredValue / contributionValue_i (§5.4)。
//   demand 集計と wellbeing fulfillment の双方が同じ解決を使う。
export type ResolvedNeedCategory = {
  category: NeedCategory
  tier: NeedTier
  desiredValue: number
  resources: {
    resource: ResourceKind
    buyOrders: number
    contributionValue: number
    share: number
  }[]
}

export function computePopNeedDemand(
  pop: PopGroup,
  config: SimulationConfig,
  priceLookup: (resource: ResourceKind) => number,
): ResolvedNeedCategory[] {
  const profile = POP_NEED_PROFILES[pop.popType]
  const beta = config.needResourceChoiceBeta
  const result: ResolvedNeedCategory[] = []
  for (const category of NEED_CATEGORIES) {
    const amountPerPop = profile[category]
    if (amountPerPop <= 0) continue
    const tier = getNeedCategoryTier(pop.class, category)
    const tierScale = tier === 'essential' ? config.popEssentialNeedScale : 1
    const desiredValue = amountPerPop * pop.size * tierScale // v0.58: full desired（予算制約は呼び出し側）
    if (desiredValue <= 0) continue
    const shares = resolveCategoryShares(NEED_CATEGORY_CONTRIBUTIONS[category], priceLookup, beta)
    const resources = shares.map((s) => ({
      resource: s.resource,
      contributionValue: s.contributionValue,
      share: s.share,
      buyOrders: (s.share * desiredValue) / s.contributionValue,
    }))
    if (resources.length === 0) continue
    result.push({ category, tier, desiredValue, resources })
  }
  return result
}
