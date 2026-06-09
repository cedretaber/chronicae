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
  // 直近で策謀 (Plot) が解決した絶対週。plotCooldownWeeks の待機判定に使う (連発防止)。
  lastPlotResolvedWeek?: number
  creationKind?: HouseCreationKind
  creationReason?: HouseCreationReason
  clanId?: ClanId
}
