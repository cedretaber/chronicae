import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopOccupation } from '../types/popGroup'

export type ImprovementDefinition = {
  kind: HoldingImprovementKind
  allowedHoldingKinds: HoldingKind[]
  allowedTerrains?: ProvinceTerrain[]
  requiredAnyFeatures?: ProvinceFeature[]
  capacityRole: 'capacity' | 'production_quality'
  targetOccupations?: PopOccupation[]
}

export const IMPROVEMENT_DEFINITIONS: Record<HoldingImprovementKind, ImprovementDefinition> = {
  field_system: {
    kind: 'field_system',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'hills', 'wetlands', 'forest'],
    capacityRole: 'capacity',
    targetOccupations: ['agriculture'],
  },
  pastoral_infrastructure: {
    kind: 'pastoral_infrastructure',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'hills', 'mountains', 'forest'],
    capacityRole: 'capacity',
    targetOccupations: ['agriculture'],
  },
  irrigation_infrastructure: {
    kind: 'irrigation_infrastructure',
    allowedHoldingKinds: ['manor'],
    allowedTerrains: ['plains', 'wetlands', 'hills'],
    requiredAnyFeatures: ['major_river', 'lake'],
    capacityRole: 'capacity',
    targetOccupations: ['agriculture'],
  },
  market_infrastructure: {
    kind: 'market_infrastructure',
    allowedHoldingKinds: ['city'],
    capacityRole: 'capacity',
    targetOccupations: ['urban_labor', 'elite_service'],
  },
  workshop_infrastructure: {
    kind: 'workshop_infrastructure',
    allowedHoldingKinds: ['city'],
    capacityRole: 'capacity',
    targetOccupations: ['urban_labor'],
  },
  storage_infrastructure: {
    kind: 'storage_infrastructure',
    allowedHoldingKinds: ['manor', 'city'],
    capacityRole: 'production_quality',
  },
  transport_infrastructure: {
    kind: 'transport_infrastructure',
    allowedHoldingKinds: ['manor', 'city'],
    capacityRole: 'production_quality',
  },
}
