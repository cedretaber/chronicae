import type { ProvinceId, PopGroupId } from './ids'

export type Province = {
  id: ProvinceId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  habitability: number
  development: number
  polityControl: number
  popGroupIds: PopGroupId[]
}
