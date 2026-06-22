import type { SimulationConfig } from '../config/defaultConfig'
import type { PopGroup } from '../types/popGroup'
import type { ResourceKind } from '../types/resource'
import type { NeedCategory, NeedTier } from '../types/needCategory'
import {
  NEED_CATEGORIES,
  NEED_CATEGORY_TIER,
  NEED_CATEGORY_CONTRIBUTIONS,
} from '../types/needCategory'
import { POP_NEED_PROFILES } from '../config/popNeedDefinitions'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import { resolveCategoryShares } from './resourceChoiceSelectors'
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
    const tier = NEED_CATEGORY_TIER[category]
    const desiredValue = amountPerPop * pop.size // v0.58: full desired（予算制約は呼び出し側）
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
