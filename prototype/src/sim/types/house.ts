import type { HouseId, ProvinceId, PersonId } from './ids'

export type HouseKind = 'normal' | 'system'

export type House = {
  id: HouseId
  name: string
  active: boolean
  kind?: HouseKind
  memberIds: PersonId[]
  founderId?: PersonId
  parentHouseId?: HouseId
  cadetHouseIds: HouseId[]
  nameSource?: 'pool' | 'province' | 'founder' | 'fallback'
  legacyPrestige: number // 0..100
  wealth: number // >= 0
  seatProvinceId: ProvinceId
}
