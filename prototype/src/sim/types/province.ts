import type { ProvinceId, StateRegionId, HoldingId } from './ids'

export type Province = {
  id: ProvinceId
  stateId: StateRegionId
  nameKey: string
  x: number
  y: number
  neighbors: ProvinceId[]
  habitability: number
  holdingIds: HoldingId[]
}
