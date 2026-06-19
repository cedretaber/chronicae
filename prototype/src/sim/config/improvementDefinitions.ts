import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopClass } from '../types/popGroup'

export type ImprovementEmploymentSlot = {
  popClass: PopClass
  capacityPerLevel: number
}

export type ImprovementDefinition = {
  kind: HoldingImprovementKind
  allowedHoldingKinds: HoldingKind[]
  allowedTerrains?: ProvinceTerrain[]
  requiredAnyFeatures?: ProvinceFeature[]
  capacityRole: 'capacity' | 'production_quality'
  employmentSlots?: ImprovementEmploymentSlot[]
  critical?: boolean
}

export const IMPROVEMENT_DEFINITIONS: Record<HoldingImprovementKind, ImprovementDefinition> = {
  manor_house: {
    kind: 'manor_house',
    allowedHoldingKinds: ['manor'],
    capacityRole: 'capacity',
    employmentSlots: [{ popClass: 'nobles', capacityPerLevel: 3 }],
    critical: true,
  },
  town_hall: {
    kind: 'town_hall',
    allowedHoldingKinds: ['city'],
    capacityRole: 'capacity',
    employmentSlots: [
      { popClass: 'townsmen', capacityPerLevel: 10 },
      { popClass: 'nobles', capacityPerLevel: 3 },
    ],
    critical: true,
  },
  irrigation_infrastructure: {
    kind: 'irrigation_infrastructure',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'wetlands', 'hills'],
    requiredAnyFeatures: ['major_river', 'lake'],
    capacityRole: 'production_quality',
  },
  market_infrastructure: {
    kind: 'market_infrastructure',
    allowedHoldingKinds: ['city'],
    capacityRole: 'production_quality',
  },
  workshop_infrastructure: {
    kind: 'workshop_infrastructure',
    allowedHoldingKinds: ['city'],
    capacityRole: 'production_quality',
  },
  storage_infrastructure: {
    kind: 'storage_infrastructure',
    allowedHoldingKinds: ['manor', 'city'],
    capacityRole: 'capacity',
    employmentSlots: [{ popClass: 'townsmen', capacityPerLevel: 20 }],
  },
  transport_infrastructure: {
    kind: 'transport_infrastructure',
    allowedHoldingKinds: ['manor', 'city'],
    capacityRole: 'production_quality',
  },
}
