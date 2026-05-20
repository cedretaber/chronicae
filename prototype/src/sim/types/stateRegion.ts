import type { StateRegionId, ProvinceId } from './ids'

export type StateRegion = {
  id: StateRegionId
  name: string
  provinceIds: ProvinceId[]
  gridCol: number
  gridRow: number
}
