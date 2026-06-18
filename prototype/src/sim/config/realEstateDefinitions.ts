import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopOccupation, PopClass } from '../types/popGroup'
import type { HoldingImprovementKind } from '../types/holdingImprovement'

export type RealEstateEmploymentSlot = {
  popClass: PopClass
  occupation: PopOccupation
  capacityPerLevel: number
}

export type RealEstateInfrastructureModifier = {
  infraKind: HoldingImprovementKind
  modifierPerLevel: number
}

export type RealEstateDefinition = {
  realEstateKind: RealEstateKind
  allowedHoldingKinds: HoldingKind[]
  allowedTerrains?: ProvinceTerrain[]
  requiredAnyFeatures?: ProvinceFeature[]
  usesSlot: boolean
  fixedInstitution: boolean
  maxLevelByHoldingKind: Partial<Record<HoldingKind, number>>
  employmentSlots: RealEstateEmploymentSlot[]
  developmentScorePerLevel: number
}

export const REAL_ESTATE_DEFINITIONS: Record<RealEstateKind, RealEstateDefinition> = {
  field: {
    realEstateKind: 'field',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'hills', 'wetlands', 'forest'],
    usesSlot: true,
    fixedInstitution: false,
    maxLevelByHoldingKind: { manor: 3 },
    employmentSlots: [{ popClass: 'peasants', occupation: 'agriculture', capacityPerLevel: 50 }],
    developmentScorePerLevel: 3,
  },
  pasture: {
    realEstateKind: 'pasture',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'hills', 'mountains', 'forest'],
    usesSlot: true,
    fixedInstitution: false,
    maxLevelByHoldingKind: { manor: 3 },
    employmentSlots: [{ popClass: 'peasants', occupation: 'agriculture', capacityPerLevel: 40 }],
    developmentScorePerLevel: 3,
  },
  workshop: {
    realEstateKind: 'workshop',
    allowedHoldingKinds: ['city'],
    usesSlot: true,
    fixedInstitution: false,
    maxLevelByHoldingKind: { city: 3 },
    employmentSlots: [{ popClass: 'townsmen', occupation: 'urban_labor', capacityPerLevel: 50 }],
    developmentScorePerLevel: 4,
  },
  shop: {
    realEstateKind: 'shop',
    allowedHoldingKinds: ['city'],
    usesSlot: true,
    fixedInstitution: false,
    maxLevelByHoldingKind: { city: 3 },
    employmentSlots: [
      { popClass: 'townsmen', occupation: 'urban_labor', capacityPerLevel: 40 },
      { popClass: 'nobles', occupation: 'elite_service', capacityPerLevel: 3 },
    ],
    developmentScorePerLevel: 4,
  },
  warehouse: {
    realEstateKind: 'warehouse',
    allowedHoldingKinds: ['manor', 'city'],
    usesSlot: true,
    fixedInstitution: false,
    maxLevelByHoldingKind: { manor: 1, city: 3 },
    employmentSlots: [{ popClass: 'townsmen', occupation: 'urban_labor', capacityPerLevel: 20 }],
    developmentScorePerLevel: 3,
  },
  lord_hall: {
    realEstateKind: 'lord_hall',
    allowedHoldingKinds: ['manor'],
    usesSlot: false,
    fixedInstitution: true,
    maxLevelByHoldingKind: { manor: 1 },
    employmentSlots: [{ popClass: 'nobles', occupation: 'elite_service', capacityPerLevel: 3 }],
    developmentScorePerLevel: 2,
  },
  town_hall: {
    realEstateKind: 'town_hall',
    allowedHoldingKinds: ['city'],
    usesSlot: false,
    fixedInstitution: true,
    maxLevelByHoldingKind: { city: 1 },
    employmentSlots: [{ popClass: 'townsmen', occupation: 'urban_labor', capacityPerLevel: 10 }],
    developmentScorePerLevel: 2,
  },
}
