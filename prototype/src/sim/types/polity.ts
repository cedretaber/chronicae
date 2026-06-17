import type {
  PolityId,
  HouseId,
  ProvinceId,
  HoldingId,
  PersonId,
  DiplomaticPlayId,
  WarId,
  LandContractId,
} from './ids'
import type { PopClass } from './popGroup'

export type PolityRank = 1 | 2 | 3 | 4 | 5

// v0.18-pre: 'commonwealth' は ownerHouseId === undefined を恒常的に許容する状態。
// 現状は createRebelPolity でのみ生成され、双方向遷移は未実装。
// undefined は 'normal' と等価扱い (backward compatibility)。
type PolityKind = 'normal' | 'commonwealth'

// v0.47 §2.1: territorial = 実領を伴う通常状態 (undefined も territorial 扱い)。
// titular = 称号のみで土地契約 0 (rank 2〜4。rank 5 は titular になれず abolish される)。
// active=false (abolished) は称号自体の廃止であり titular とは異なる。
export type PolityTerritorialStatus = 'territorial' | 'titular'

export type PolityOrigin =
  | { kind: 'worldgen' }
  | {
      kind: 'popular_revolt'
      originalPolityId: PolityId
      provinceId: ProvinceId
      holdingIds: HoldingId[]
      popClass: PopClass
      leaderPersonId: PersonId
      startedWeek: number
    }
  | {
      kind: 'regime_changed_by_popular_revolt'
      previousOwnerHouseId?: HouseId
      provinceId: ProvinceId
      holdingId: HoldingId
      popClass: PopClass
      leaderPersonId: PersonId
      week: number
    }
  // v0.47 §2.2: 分封由来の rank 5 Polity。ownerHouseId は創設時履歴値であり、
  // 後年の Polity 譲渡 (§11) で polity.ownerHouseId が変化しても origin は更新しない
  // (origin.ownerHouseId と現在の polity.ownerHouseId は一致するとは限らない・§19.5)。
  | {
      kind: 'land_grant'
      grantorPolityId: PolityId
      founderPersonId: PersonId
      ownerHouseId: HouseId
      parentHouseId?: HouseId
      holdingId: HoldingId
      week: number
    }

type PopularRevoltState =
  | { kind: 'negotiating'; diplomaticPlayId: DiplomaticPlayId }
  | { kind: 'revolting'; warId?: WarId; revoltSeizureContractIds: LandContractId[] }
  | { kind: 'established' }

// v0.41 (§3.2/§3.3): Polity の名前情報。pool 由来は自前の nameKey を持ち、
// holding 由来は対象 Holding の名前を借りる (解決カテゴリは Holding.kind で決まる)。
type PolityNameSource =
  | { kind: 'pool'; nameKey: string }
  | { kind: 'holding'; holdingId: HoldingId }

export type Polity = {
  id: PolityId
  nameSource: PolityNameSource
  treasury: number // >= 0
  adminPower: number // 0..100, cache: recalculated each January
  legacyPrestige: number // 0..100
  active: boolean
  lastWarWeek?: number
  capitalProvinceId: ProvinceId
  ownerHouseId?: HouseId
  rank: PolityRank
  kind?: PolityKind
  // v0.47 §2.1: undefined は 'territorial' とみなす。worldgen 既存 Polity には明示セット不要。
  territorialStatus?: PolityTerritorialStatus
  origin: PolityOrigin
  revoltState?: PopularRevoltState
  // v0.46 §3.4: established commonwealth (共和国) の建国式 (RepublicPoliticalInitializationSystem)
  // が一度だけ完了した絶対週。未設定 = 未初期化。AppointmentSystem との race / 再 seed /
  // REPUBLIC_FOUNDED 多重発火を once-guard する marker。
  republicInitializedWeek?: number
}

// v0.47 §2.1: territorialStatus の正規化アクセサ (undefined → 'territorial')。
export function getPolityTerritorialStatus(polity: Polity): PolityTerritorialStatus {
  return polity.territorialStatus ?? 'territorial'
}
