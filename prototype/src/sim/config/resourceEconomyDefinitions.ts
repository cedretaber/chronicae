import type { ResourceKind } from '../types/resource'
import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingImprovementKind } from '../types/holdingImprovement'

// v0.54 市場清算 rewrite (§6.3c.1) 価格計算 config (資源ごと)。
//   price = basePrice × (1 + marketPriceSwing × clamp(imbalance, −1, 1))。
//   資源別の min/max/elasticity は廃止 — 価格幅は全資源共通 (marketPriceSwing) で basePrice のみ資源別に維持。
export type ResourcePriceConfig = {
  basePrice: number
}

// v0.55 §4.3: 21 種の初期 basePrice (調整前提)。
export const RESOURCE_PRICE_DEFINITIONS: Record<ResourceKind, ResourcePriceConfig> = {
  grain: { basePrice: 0.5 },
  fish: { basePrice: 1.2 },
  meat: { basePrice: 1.4 },
  fruit: { basePrice: 1.8 },
  beer: { basePrice: 1.4 },
  wine: { basePrice: 3.5 },

  flax: { basePrice: 0.9 },
  wool: { basePrice: 1.1 },
  timber: { basePrice: 1.0 },
  stone: { basePrice: 0.9 },
  iron_ore: { basePrice: 1.6 },
  fur: { basePrice: 3.0 },
  gems: { basePrice: 7.0 },
  dye: { basePrice: 2.2 },

  tools: { basePrice: 3.5 },
  fabric: { basePrice: 2.2 },
  clothes: { basePrice: 4.5 },
  luxury_clothes: { basePrice: 9.0 },
  jewelry: { basePrice: 14.0 },
  smoked_fish: { basePrice: 2.4 },
  processed_meat: { basePrice: 2.6 },
}

// v0.55 §4.3a smoothedPrice cold-start fallback: 21 種は v0.55 新規導入のため初月は価格 history が
//   無く smoothedPrice が未定義。smoothedPrice を読む全箇所で不在時は basePrice を fallback とする。
export function getSmoothedPriceOrBase(
  smoothedPrice: number | undefined,
  resource: ResourceKind,
): number {
  if (smoothedPrice !== undefined) return smoothedPrice
  return RESOURCE_PRICE_DEFINITIONS[resource].basePrice
}

// v0.54 §11.2 生産施設 modifier (capacity 用の realEstateInfrastructureModifiers とは別物)。
//   facilityModifier = 1.0 + Σ bonusPerLevel * level * conditionFactor * staffingFulfillment。
//   施設ボーナス部分だけを condition/staffing で減衰させ、基礎生産性 (1.0) には掛けない (§11.2 良い例)。
export type RealEstateProductionFacilityModifier = {
  improvementKind: HoldingImprovementKind
  bonusPerLevel: number
}

export const REAL_ESTATE_PRODUCTION_FACILITY_MODIFIERS: Record<
  RealEstateKind,
  RealEstateProductionFacilityModifier[]
> = {
  farm: [
    { improvementKind: 'irrigation_infrastructure', bonusPerLevel: 0.15 },
    { improvementKind: 'transport_infrastructure', bonusPerLevel: 0.1 },
  ],
  mountain: [{ improvementKind: 'transport_infrastructure', bonusPerLevel: 0.1 }],
  woodland: [{ improvementKind: 'transport_infrastructure', bonusPerLevel: 0.1 }],
  workshop: [
    { improvementKind: 'workshop_infrastructure', bonusPerLevel: 0.15 },
    { improvementKind: 'market_infrastructure', bonusPerLevel: 0.1 },
    { improvementKind: 'transport_infrastructure', bonusPerLevel: 0.1 },
  ],
}

// v0.59 追補③: 改良 kind → それが生産性を boost する RealEstateKind 群 (上の逆引き・module 初期化時に派生)。
//   「品薄資源を生産する asset を boost できる production_quality 改良はどれか」の選定に使う。
export const IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS: Partial<
  Record<HoldingImprovementKind, RealEstateKind[]>
> = (() => {
  const map: Partial<Record<HoldingImprovementKind, RealEstateKind[]>> = {}
  for (const reKind of Object.keys(REAL_ESTATE_PRODUCTION_FACILITY_MODIFIERS) as RealEstateKind[]) {
    for (const mod of REAL_ESTATE_PRODUCTION_FACILITY_MODIFIERS[reKind]) {
      ;(map[mod.improvementKind] ??= []).push(reKind)
    }
  }
  return map
})()
