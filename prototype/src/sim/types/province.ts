import type { ProvinceId, PopGroupId, StateRegionId, HoldingId } from './ids'

export type Province = {
  id: ProvinceId
  stateId: StateRegionId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  habitability: number
  holdingIds: HoldingId[]
  popGroupIds: PopGroupId[]
}
