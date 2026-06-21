import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopClass } from '../types/popGroup'

export type RealEstateEmploymentSlot = {
  popClass: PopClass
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
  farm: {
    realEstateKind: 'farm',
    allowedHoldingKinds: ['manor', 'city'],
    allowedTerrains: ['plains', 'wetlands', 'hills', 'forest'],
    maxLevelByHoldingKind: { manor: 3, city: 2 },
    employmentSlots: [{ popClass: 'peasants', capacityPerLevel: 50 }],
    developmentScorePerLevel: 3,
  },
  mountain: {
    realEstateKind: 'mountain',
    allowedHoldingKinds: ['manor', 'city'],
    allowedTerrains: ['mountains', 'hills'],
    maxLevelByHoldingKind: { manor: 3, city: 2 },
    employmentSlots: [{ popClass: 'peasants', capacityPerLevel: 35 }],
    developmentScorePerLevel: 3,
  },
  woodland: {
    realEstateKind: 'woodland',
    allowedHoldingKinds: ['manor', 'city'],
    allowedTerrains: ['forest', 'hills'],
    maxLevelByHoldingKind: { manor: 3, city: 2 },
    employmentSlots: [{ popClass: 'peasants', capacityPerLevel: 40 }],
    developmentScorePerLevel: 3,
  },
  workshop: {
    realEstateKind: 'workshop',
    allowedHoldingKinds: ['city'],
    maxLevelByHoldingKind: { city: 3 },
    employmentSlots: [{ popClass: 'townsmen', capacityPerLevel: 80 }],
    developmentScorePerLevel: 4,
  },
}
