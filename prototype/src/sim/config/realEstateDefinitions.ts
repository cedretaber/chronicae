import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopStratum } from '../types/popGroup'

// v0.55 §13.4: multi-stratum employment。1 kind が複数 stratum を同時雇用する。
//   capacityPerLevel は per-stratum (base capacity × stratum weight) を事前計算した値。
export type RealEstateEmploymentSlot = {
  stratum: PopStratum
  capacityPerLevel: number
}

export type RealEstateInfrastructureModifier = {
  infraKind: import('../types/holdingImprovement').HoldingImprovementKind
  modifierPerLevel: number
}

export type RealEstateDefinition = {
  realEstateKind: RealEstateKind
  allowedHoldingKinds: HoldingKind[]
  allowedTerrains?: ProvinceTerrain[]
  requiredAnyFeatures?: ProvinceFeature[]
  maxLevelByHoldingKind: Partial<Record<HoldingKind, number>>
  employmentSlots: RealEstateEmploymentSlot[]
  developmentScorePerLevel: number
}

// v0.55 §23.1a: 4 kind 定義。allowedTerrains が RealEstateKind 単位の terrain gate
//   (recipe 側 terrain gate §8.1 は型のみで enforce しないのと混同しない)。
//   employmentSlots の popClass は Phase 1 では旧 PopClass を維持 (Phase 3 で PopStratum 化)。
export const REAL_ESTATE_DEFINITIONS: Record<RealEstateKind, RealEstateDefinition> = {
  // capacityPerLevel = base (§23.1a) × stratum weight (§13.4)。
  farm: {
    realEstateKind: 'farm',
    allowedHoldingKinds: ['manor', 'city'],
    allowedTerrains: ['plains', 'wetlands', 'hills', 'forest'],
    maxLevelByHoldingKind: { manor: 3, city: 2 },
    // base 50 × (lower 0.80 / middle 0.20)
    employmentSlots: [
      { stratum: 'lower', capacityPerLevel: 40 },
      { stratum: 'middle', capacityPerLevel: 10 },
    ],
    developmentScorePerLevel: 3,
  },
  mountain: {
    realEstateKind: 'mountain',
    allowedHoldingKinds: ['manor', 'city'],
    allowedTerrains: ['mountains', 'hills'],
    maxLevelByHoldingKind: { manor: 3, city: 2 },
    // base 35 × (lower 0.90 / middle 0.10)
    employmentSlots: [
      { stratum: 'lower', capacityPerLevel: 31.5 },
      { stratum: 'middle', capacityPerLevel: 3.5 },
    ],
    developmentScorePerLevel: 3,
  },
  woodland: {
    realEstateKind: 'woodland',
    allowedHoldingKinds: ['manor', 'city'],
    allowedTerrains: ['forest', 'hills'],
    maxLevelByHoldingKind: { manor: 3, city: 2 },
    // base 40 × (lower 0.85 / middle 0.15)
    employmentSlots: [
      { stratum: 'lower', capacityPerLevel: 34 },
      { stratum: 'middle', capacityPerLevel: 6 },
    ],
    developmentScorePerLevel: 3,
  },
  workshop: {
    realEstateKind: 'workshop',
    allowedHoldingKinds: ['city'],
    maxLevelByHoldingKind: { city: 3 },
    // base 80 × (lower 0.75 / middle 0.25)
    employmentSlots: [
      { stratum: 'lower', capacityPerLevel: 60 },
      { stratum: 'middle', capacityPerLevel: 20 },
    ],
    developmentScorePerLevel: 4,
  },
}
