import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopOccupation, PopClass } from '../types/popGroup'

export type RealEstateEmploymentSlot = {
  popClass: PopClass
  occupation: PopOccupation
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

export const REAL_ESTATE_DEFINITIONS: Record<RealEstateKind, RealEstateDefinition> = {
  field: {
    realEstateKind: 'field',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'hills', 'wetlands', 'forest'],
    maxLevelByHoldingKind: { manor: 3 },
    employmentSlots: [{ popClass: 'peasants', occupation: 'agriculture', capacityPerLevel: 50 }],
    developmentScorePerLevel: 3,
  },
  pasture: {
    realEstateKind: 'pasture',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'hills', 'mountains', 'forest'],
    maxLevelByHoldingKind: { manor: 3 },
    employmentSlots: [{ popClass: 'peasants', occupation: 'agriculture', capacityPerLevel: 40 }],
    developmentScorePerLevel: 3,
  },
  workshop: {
    realEstateKind: 'workshop',
    allowedHoldingKinds: ['city'],
    maxLevelByHoldingKind: { city: 3 },
    employmentSlots: [{ popClass: 'townsmen', occupation: 'urban_labor', capacityPerLevel: 80 }],
    developmentScorePerLevel: 4,
  },
}
