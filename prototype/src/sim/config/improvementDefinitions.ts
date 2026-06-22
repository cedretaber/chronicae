import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopType } from '../types/popGroup'

// v0.57 §雇用細分化: improvement の establishment (定員) を PopType 単位で持つ。
//   establishment は holding の生産容量プールとは別の外生的な雇用枠 (管理・治安・維持の人員)。
//   capacityPerLevel は level あたり establishment 総数 × その PopType の構成比。
export type ImprovementEmploymentSlot = {
  popType: PopType
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
  // 領主館: 貴族:家士:兵士:労働者 = 1:2:3:4 (total 20/level)。領地の維持・管理。
  manor_house: {
    kind: 'manor_house',
    allowedHoldingKinds: ['manor'],
    capacityRole: 'capacity',
    employmentSlots: [
      { popType: 'nobles', capacityPerLevel: 2 },
      { popType: 'ministeriales', capacityPerLevel: 4 },
      { popType: 'soldiers', capacityPerLevel: 6 },
      { popType: 'laborers', capacityPerLevel: 8 },
    ],
    critical: true,
  },
  // 市庁舎: 都市貴族:官僚:兵士:労働者 = 1:2:3:4 (total 20/level)。
  town_hall: {
    kind: 'town_hall',
    allowedHoldingKinds: ['city'],
    capacityRole: 'capacity',
    employmentSlots: [
      { popType: 'patricians', capacityPerLevel: 2 },
      { popType: 'bureaucrats', capacityPerLevel: 4 },
      { popType: 'soldiers', capacityPerLevel: 6 },
      { popType: 'laborers', capacityPerLevel: 8 },
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
  // 倉庫: 労働者:商人:書記 = 8:1:1 (total 20/level)。
  storage_infrastructure: {
    kind: 'storage_infrastructure',
    allowedHoldingKinds: ['manor', 'city'],
    capacityRole: 'capacity',
    employmentSlots: [
      { popType: 'laborers', capacityPerLevel: 16 },
      { popType: 'merchants', capacityPerLevel: 2 },
      { popType: 'scribes', capacityPerLevel: 2 },
    ],
  },
  transport_infrastructure: {
    kind: 'transport_infrastructure',
    allowedHoldingKinds: ['manor', 'city'],
    capacityRole: 'production_quality',
  },
}
