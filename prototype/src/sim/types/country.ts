import type { CountryId, HouseId, ProvinceId } from './ids'

export type Country = {
  id: CountryId
  name: string
  houseIds: HouseId[]
  treasury: number // >= 0
  adminPower: number // 0..100, cache: recalculated each January
  legacyPrestige: number // 0..100
  active: boolean
  lastWarMonth?: number
  capitalProvinceId: ProvinceId
}
