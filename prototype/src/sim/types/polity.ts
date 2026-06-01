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

export type Polity = {
  id: PolityId
  nameKey: string
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
}
