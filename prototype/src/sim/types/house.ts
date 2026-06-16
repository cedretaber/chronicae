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
 * - 'person': founder の個人名由来 (person.yaml で解決)。共和国 House 創設は
 *   petitioner.nameKey をそのまま家名にするため、house category では解決できず raw key 表示に
 *   なる。表示・emit 側は nameSource を見て category を切り替える。
 * - { kind: 'polity', category }: 下賜された Polity (領国) の名前を家名にする (v0.47.x)。
 *   分封 (land_grant) と分家 (titleTransfer) で「家 = その領国の名前」を実現する。創設時に
 *   領国名の (category, nameKey) を house へ snapshot する (家名は王朝名として固定 = 後で領国を
 *   失っても変わらない)。category はその nameKey の解決名前空間:
 *     - 'province' / 'city': 領国名が holding 由来 (manor→province / city→city)。
 *       分封の新設 Polity は常に holding 名、分家で譲渡される Polity が holding 名の場合も該当。
 *     - 'polity': 領国名が pool 由来 (polity.yaml)。分家で譲渡される worldgen 由来 Polity 等。
 */
export type HouseNameSource =
  | 'pool'
  | 'person'
  | { kind: 'polity'; category: 'province' | 'city' | 'polity' }

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
  // v0.51 陰謀リファイン: 直近で陰謀 Project が terminal 化した絶対週。conspiracyCooldownWeeks の
  //   待機判定に使う (連発防止 = 旧 Klaus ループ再発防止)。
  lastConspiracyResolvedWeek?: number
  creationKind?: HouseCreationKind
  creationReason?: HouseCreationReason
  clanId?: ClanId
}
