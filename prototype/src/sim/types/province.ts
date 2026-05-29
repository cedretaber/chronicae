import type { ProvinceId, StateRegionId, HoldingId } from './ids'

/** Province の地形タイプ（v0.33: habitability スカラーを置換）。 */
export type ProvinceTerrain = 'plains' | 'forest' | 'hills' | 'mountains' | 'wetlands'

/** Province が持ちうる地理特徴（複数可・順不同）。 */
export type ProvinceFeature = 'coastal' | 'major_river' | 'lake'

export type Province = {
  id: ProvinceId
  stateId: StateRegionId
  nameKey: string
  x: number
  y: number
  neighbors: ProvinceId[]
  terrain: ProvinceTerrain
  features: ProvinceFeature[]
  holdingIds: HoldingId[]
}
