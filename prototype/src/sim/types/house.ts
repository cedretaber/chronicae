import type { HouseId, ProvinceId, PersonId, ClanId } from './ids'

export type HouseKind = 'normal' | 'system'

export type HouseCreationKind = 'cadet_branch' | 'self_made_foundation'

export type HouseCreationReason =
  | 'house_split'
  | 'wealth'
  | 'office'
  | 'prestige'
  | 'land_grant'
  | 'polity_grant'
  | 'succession'
  | 'peace_settlement'

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
  creationKind?: HouseCreationKind
  creationReason?: HouseCreationReason
  clanId?: ClanId
}
