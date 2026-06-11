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

/**
 * 家名 nameKey がどの name プールに属するか (v0.47)。
 * - 'pool' (既定 / undefined): house プール由来 (house.yaml で解決)。
 * - 'person': founder の個人名由来 (person.yaml で解決)。分封 / 分家(Polity 譲渡) /
 *   共和国 House 創設は petitioner.nameKey をそのまま家名にするため、house category では
 *   解決できず raw key 表示になる。表示・emit 側は nameSource を見て category を切り替える。
 */
export type HouseNameSource = 'pool' | 'person'

export type House = {
  id: HouseId
  nameKey: string
  /** 家名の出所。undefined は 'pool' と同義 (既存 House は触らない additive フィールド)。 */
  nameSource?: HouseNameSource
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
