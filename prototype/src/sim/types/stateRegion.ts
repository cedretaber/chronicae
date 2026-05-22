import type { StateRegionId, ProvinceId } from './ids'

export type StateRegion = {
  id: StateRegionId
  nameKey: string
  provinceIds: ProvinceId[]
  centerX: number
  centerY: number
}
