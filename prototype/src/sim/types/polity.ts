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
export type PolityKind = 'normal' | 'commonwealth'

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

export type PopularRevoltState =
  | { kind: 'negotiating'; diplomaticPlayId: DiplomaticPlayId }
  | { kind: 'revolting'; warId?: WarId; revoltSeizureContractIds: LandContractId[] }
  | { kind: 'established' }

// v0.41 (§3.2/§3.3): Polity の名前情報。pool 由来は自前の nameKey を持ち、
// holding 由来は対象 Holding の名前を借りる (解決カテゴリは Holding.kind で決まる)。
export type PolityNameSource =
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
  origin: PolityOrigin
  revoltState?: PopularRevoltState
  // v0.46 §3.4: established commonwealth (共和国) の建国式 (RepublicPoliticalInitializationSystem)
  // が一度だけ完了した絶対週。未設定 = 未初期化。AppointmentSystem との race / 再 seed /
  // REPUBLIC_FOUNDED 多重発火を once-guard する marker。
  republicInitializedWeek?: number
}
