import type { ResourceKind } from '../types/resource'
import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingImprovementKind } from '../types/holdingImprovement'

// v0.54 市場清算 rewrite (§6.3c.1) 価格計算 config (資源ごと)。
//   price = basePrice × (1 + marketPriceSwing × clamp(imbalance, −1, 1))。
//   資源別の min/max/elasticity は廃止 — 価格幅は全資源共通 (marketPriceSwing) で basePrice のみ資源別に維持。
export type ResourcePriceConfig = {
  basePrice: number
}

export const RESOURCE_PRICE_DEFINITIONS: Record<ResourceKind, ResourcePriceConfig> = {
  food: { basePrice: 1.0 },
  raw_materials: { basePrice: 1.2 },
  processed_goods: { basePrice: 2.0 },
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
  field: [
    { improvementKind: 'irrigation_infrastructure', bonusPerLevel: 0.15 },
    { improvementKind: 'transport_infrastructure', bonusPerLevel: 0.1 },
  ],
  pasture: [{ improvementKind: 'transport_infrastructure', bonusPerLevel: 0.1 }],
  workshop: [
    { improvementKind: 'workshop_infrastructure', bonusPerLevel: 0.15 },
    { improvementKind: 'market_infrastructure', bonusPerLevel: 0.1 },
    { improvementKind: 'transport_infrastructure', bonusPerLevel: 0.1 },
  ],
}
