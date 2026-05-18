import type { HouseId, ProvinceId, PersonId } from './ids'

export type House = {
  id: HouseId
  name: string
  active: boolean
  provinceIds: ProvinceId[]
  memberIds: PersonId[]
  founderId?: PersonId
  parentHouseId?: HouseId
  cadetHouseIds: HouseId[]
  nameSource?: 'pool' | 'province' | 'founder' | 'fallback'
  legacyPrestige: number // 0..100
  wealth: number // >= 0
  seatProvinceId: ProvinceId
}
