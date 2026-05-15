import type { ProvinceId, HouseId, CountryId, PopGroupId } from './ids'

export type Province = {
  id: ProvinceId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  ownerHouseId: HouseId
  countryId: CountryId
  habitability: number
  development: number
  countryControl: number
  houseControl: number
  popGroupIds: PopGroupId[]
}
