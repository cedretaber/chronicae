import type { ProvinceId, HouseId, CountryId } from './ids'

export type Province = {
  id: ProvinceId
  name: string
  x: number
  y: number
  neighbors: ProvinceId[]
  ownerHouseId: HouseId
  countryId: CountryId
  baseTax: number // 1..10
  manpower: number // 1..10
  unrest: number // 0..100
  development: number // -100..100
  countryControl: number // 0..100
  houseControl: number // 0..100
}
