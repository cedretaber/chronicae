import type { ProvinceId, HouseId, PolityId, PopGroupId } from './ids'

export type Province = {
  id: ProvinceId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  ownerHouseId: HouseId
  polityId: PolityId
  habitability: number
  development: number
  polityControl: number
  houseControl: number
  popGroupIds: PopGroupId[]
}
