import type { ProvinceId, PopGroupId, StateRegionId } from './ids'

export type Province = {
  id: ProvinceId
  stateId: StateRegionId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  habitability: number
  development: number
  polityControl: number
  popGroupIds: PopGroupId[]
}
