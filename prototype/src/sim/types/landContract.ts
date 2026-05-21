import type {
  ProvinceId,
  PolityId,
  PersonId,
  HouseId,
  LandContractId,
  HoldingId,
  HoldingOfficeAssignmentId,
} from './ids'

export type RootAuthorityId = string & { readonly __brand: 'RootAuthorityId' }

export const ROOT_WORLD: RootAuthorityId = 'root:world' as RootAuthorityId

// provinceId は holdingId → Holding.provinceId から導出可能な冗長フィールドだが、
// Holding-Province 対応はゲーム中不変のため壊れず、多数の参照箇所で間接参照を省ける。
export type LandContract = {
  id: LandContractId
  provinceId: ProvinceId
  holdingId?: HoldingId
  parentContractId?: LandContractId
  rootAuthorityId?: RootAuthorityId
  granteePolityId: PolityId
  terms: {
    taxRateToGrantor: number
  }
}

export type LandContractGrantor =
  | { kind: 'root'; id: RootAuthorityId }
  | { kind: 'polity'; id: PolityId }

// byProvince: worldgen 時に最初の Holding の chain を登録する legacy index。
//   新規 contract 追加時は holdingId 指定で byHolding のみ更新される。
//   Province 単位の chain 検索が必要な既存コード (UI/selector) 向けに維持。
// byHolding: 各 Holding 固有の独立した contract chain。v0.20-b2 以降の正規 index。
export type LandContractIndex = {
  byProvince: Record<ProvinceId, LandContractId[]>
  byHolding: Record<HoldingId, LandContractId[]>
  byGranteePolity: Record<PolityId, LandContractId[]>
  byParent: Record<LandContractId, LandContractId | undefined>
}

export type ProvinceTerminalPolityCache = Record<ProvinceId, PolityId>

export type HoldingKind = 'manor' | 'city'

export type Holding = {
  id: HoldingId
  provinceId: ProvinceId
  kind: HoldingKind
  name: string
  development: number
  polityControl: number
  landQuality: number
  weight: number
}

export type HoldingTerminalPolityCache = Record<HoldingId, PolityId>

export type HoldingOfficeRole = 'bailiff'

export type HoldingOfficeAssignment = {
  id: HoldingOfficeAssignmentId
  holdingId: HoldingId
  role: HoldingOfficeRole
  holderPersonId: PersonId
  appointingPolityId: PolityId
  active: boolean
  startWeek: number
  unpaidCount: number
}

export type HoldingOfficeIndex = {
  byHolding: Record<HoldingId, HoldingOfficeAssignmentId | undefined>
  byHolderPerson: Record<PersonId, HoldingOfficeAssignmentId[]>
  byAppointingPolity: Record<PolityId, HoldingOfficeAssignmentId[]>
}

export type PolityIndex = {
  byOwnerHouse: Record<HouseId, PolityId[]>
}
