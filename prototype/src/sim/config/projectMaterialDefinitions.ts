import type { InputCategory } from '../types/inputCategory'
import type { RealEstateKind } from '../types/realEstateAsset'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { CrisisKind } from '../types/crisis'

// v0.55 §18.3 ProjectMaterialRequirement: 建設・修繕 Project の建築資材需要 (category 別 weight)。
//   weight は相対比 (合計 1.0 を想定)。target 別 2 段キー (B4) で引く。
export type ProjectMaterialRequirement = {
  category: InputCategory
  weight: number
}

// real_estate target (RealEstateKind 別)。
export const REAL_ESTATE_MATERIAL_PROFILE: Record<RealEstateKind, ProjectMaterialRequirement[]> = {
  farm: [
    { category: 'construction_wood', weight: 0.7 },
    { category: 'construction_tools', weight: 0.3 },
  ],
  woodland: [
    { category: 'construction_wood', weight: 0.6 },
    { category: 'construction_tools', weight: 0.4 },
  ],
  mountain: [
    { category: 'construction_wood', weight: 0.3 },
    { category: 'construction_stone', weight: 0.3 },
    { category: 'construction_tools', weight: 0.4 },
  ],
  workshop: [
    { category: 'construction_wood', weight: 0.3 },
    { category: 'construction_stone', weight: 0.4 },
    { category: 'construction_tools', weight: 0.3 },
  ],
}

// holding_improvement target (HoldingImprovementKind 別、全種網羅)。
export const IMPROVEMENT_MATERIAL_PROFILE: Record<
  HoldingImprovementKind,
  ProjectMaterialRequirement[]
> = {
  manor_house: [
    { category: 'construction_wood', weight: 0.3 },
    { category: 'construction_stone', weight: 0.5 },
    { category: 'construction_tools', weight: 0.2 },
  ],
  town_hall: [
    { category: 'construction_wood', weight: 0.3 },
    { category: 'construction_stone', weight: 0.5 },
    { category: 'construction_tools', weight: 0.2 },
  ],
  market_infrastructure: [
    { category: 'construction_wood', weight: 0.4 },
    { category: 'construction_stone', weight: 0.4 },
    { category: 'construction_tools', weight: 0.2 },
  ],
  workshop_infrastructure: [
    { category: 'construction_wood', weight: 0.3 },
    { category: 'construction_stone', weight: 0.3 },
    { category: 'construction_tools', weight: 0.4 },
  ],
  irrigation_infrastructure: [
    { category: 'construction_wood', weight: 0.2 },
    { category: 'construction_stone', weight: 0.6 },
    { category: 'construction_tools', weight: 0.2 },
  ],
  transport_infrastructure: [
    { category: 'construction_wood', weight: 0.2 },
    { category: 'construction_stone', weight: 0.6 },
    { category: 'construction_tools', weight: 0.2 },
  ],
  storage_infrastructure: [
    { category: 'construction_wood', weight: 0.6 },
    { category: 'construction_stone', weight: 0.2 },
    { category: 'construction_tools', weight: 0.2 },
  ],
}

// crisis_repair target (CrisisKind 別、修繕系のみ)。war_damage / disrepair のみ対象 (§18.2)。
export const CRISIS_REPAIR_MATERIAL_PROFILE: Partial<
  Record<CrisisKind, ProjectMaterialRequirement[]>
> = {
  war_damage: [
    { category: 'construction_wood', weight: 0.4 },
    { category: 'construction_stone', weight: 0.4 },
    { category: 'construction_tools', weight: 0.2 },
  ],
  disrepair: [
    { category: 'construction_wood', weight: 0.4 },
    { category: 'construction_stone', weight: 0.4 },
    { category: 'construction_tools', weight: 0.2 },
  ],
}
