import type { HouseId, ProvinceId, PersonId } from './ids'

export type HouseKind = 'normal' | 'system'

export type House = {
  id: HouseId
  nameKey: string
  active: boolean
  kind?: HouseKind
  memberIds: PersonId[]
  deceasedMemberIds: PersonId[]
  founderId?: PersonId
  parentHouseId?: HouseId
  cadetHouseIds: HouseId[]
  legacyPrestige: number // 0..100
  wealth: number // >= 0
  seatProvinceId: ProvinceId
  lastSplitWeek?: number
}
