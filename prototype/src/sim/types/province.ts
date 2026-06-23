import type { ProvinceId, StateRegionId, HoldingId } from './ids'
import type { ResourceKind } from './resource'

/** Province の地形タイプ（v0.33: habitability スカラーを置換）。 */
export type ProvinceTerrain = 'plains' | 'forest' | 'hills' | 'mountains' | 'wetlands'

/** Province が持ちうる地理特徴（複数可・順不同）。 */
export type ProvinceFeature = 'coastal' | 'major_river' | 'lake'

/**
 * 地形特性（v0.59）。地形・地物に相関した名前付きの特性で、Province 単位で持つ（複数可）。
 * 産出ブースト（raw 資源の per-output 倍率）またはスロット数（不動産スロット +N）を与える。
 * 定義は config 駆動（`terrainTraitDefinitions`）で、表示名は nameKey 経由（i18n 解決は app/i18n）。
 */
export type TerrainTraitKind =
  | 'fertile_land'
  | 'rich_fishery'
  | 'rich_lode'
  | 'dense_forest'
  | 'open_terrain'

/** 地形特性の効果。output=raw 資源の産出倍率 / slot=不動産スロット数の加算。 */
export type TerrainTraitEffect =
  | { kind: 'output'; resources: Partial<Record<ResourceKind, number>> }
  | { kind: 'slot'; slotBonus: number }

/** 地形特性の定義（config 駆動）。適合地形/地物・付与確率・効果を持つ。 */
export type TerrainTraitDefinition = {
  trait: TerrainTraitKind
  /** 適合地形（未指定=全地形）。 */
  eligibleTerrains?: ProvinceTerrain[]
  /** 適合地物（指定時はいずれか 1 つを持つことが条件）。 */
  eligibleFeatures?: ProvinceFeature[]
  /** 適合 Province での付与確率（terrainTraitDensityMultiplier が乗算される）。 */
  probability: number
  effect: TerrainTraitEffect
}

export type Province = {
  id: ProvinceId
  stateId: StateRegionId
  nameKey: string
  x: number
  y: number
  neighbors: ProvinceId[]
  terrain: ProvinceTerrain
  features: ProvinceFeature[]
  /** 地形特性（v0.59・複数可・付与順=定義順）。 */
  traits: TerrainTraitKind[]
  holdingIds: HoldingId[]
}
