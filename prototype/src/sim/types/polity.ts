import type { PolityId, HouseId, ProvinceId } from './ids'

export type PolityRank = 1 | 2 | 3 | 4 | 5

export type Polity = {
  id: PolityId
  name: string
  treasury: number // >= 0
  adminPower: number // 0..100, cache: recalculated each January
  legacyPrestige: number // 0..100
  active: boolean
  lastWarMonth?: number
  capitalProvinceId: ProvinceId
  ownerHouseId?: HouseId
  rank: PolityRank
}
