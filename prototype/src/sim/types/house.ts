import type { HouseId, ProvinceId, PersonId } from './ids'

export const ANONYMOUS_HOUSE_ID: HouseId = 'h-anon' as HouseId

export type HouseKind = 'normal' | 'system'

export type House = {
  id: HouseId
  name: string
  nameKey?: string
  active: boolean
  kind?: HouseKind
  memberIds: PersonId[]
  deceasedMemberIds: PersonId[]
  founderId?: PersonId
  parentHouseId?: HouseId
  cadetHouseIds: HouseId[]
  nameSource?: 'pool' | 'province' | 'founder' | 'fallback'
  legacyPrestige: number // 0..100
  wealth: number // >= 0
  seatProvinceId: ProvinceId
}
