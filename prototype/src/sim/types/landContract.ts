import type {
  ProvinceId,
  PolityId,
  PersonId,
  HouseId,
  LandContractId,
  HoldingId,
  HoldingOfficeAssignmentId,
} from './ids'

// 調査 §3.9: brand キーを ids.ts の Branded ヘルパー慣例 (_brand) に統一。
export type RootAuthorityId = string & { readonly _brand: 'RootAuthorityId' }

export const ROOT_WORLD: RootAuthorityId = 'root:world' as RootAuthorityId

export type LandContractSpecialStatus = {
  kind: 'revolt_seizure'
  revoltPolityId: PolityId
  originalTerminalPolityId: PolityId
  startedWeek: number
}

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
  termsProtectedUntilWeek?: number
  specialStatus?: LandContractSpecialStatus
  lastTaxChangedWeek?: number
  previousTaxRate?: number
  taxIncreaseCooldownUntilWeek?: number
}

export type LandContractGrantor =
  | { kind: 'root'; id: RootAuthorityId }
  | { kind: 'polity'; id: PolityId }

// byHolding: 各 Holding 固有の独立した contract chain。v0.20-b2 以降の正規 index。
//   調査 §4.1: 旧 byProvince (worldgen 凍結の province 単位 1 チェーン) は撤去。province 粒度の
//   表現が要る箇所は dominant holding を province 代表とする (landContractSelectors 参照)。
export type LandContractIndex = {
  byHolding: Record<HoldingId, LandContractId[]>
  byGranteePolity: Record<PolityId, LandContractId[]>
  byParent: Record<LandContractId, LandContractId | undefined>
}

export type ProvinceTerminalPolityCache = Record<ProvinceId, PolityId>

export type HoldingKind = 'manor' | 'city'

export type Holding = {
  id: HoldingId
  provinceId: ProvinceId
  nameKey: string
  kind: HoldingKind
  polityControl: number
  landQuality: number
  weight: number
  lastRevoltSuppressedWeek?: number
  lastRevoltSettledWeek?: number
}

export type HoldingTerminalPolityCache = Record<HoldingId, PolityId>

export type HoldingOfficeRole = 'bailiff'

export type BailiffPolicy = 'passive' | 'loyal_remittance' | 'profit_seeking' | 'protect_residents'

export type HoldingOfficeAssignment = {
  id: HoldingOfficeAssignmentId
  holdingId: HoldingId
  role: HoldingOfficeRole
  holderPersonId: PersonId
  appointingPolityId: PolityId
  active: boolean
  startWeek: number
  unpaidCount: number
  contractedRemittanceRate: number
  expectedFeeRate: number
  termProtectedUntilWeek?: number
}

export type HoldingOfficeIndex = {
  byHolding: Record<HoldingId, HoldingOfficeAssignmentId | undefined>
  byHolderPerson: Record<PersonId, HoldingOfficeAssignmentId[]>
  byAppointingPolity: Record<PolityId, HoldingOfficeAssignmentId[]>
}

export type PolityIndex = {
  byOwnerHouse: Record<HouseId, PolityId[]>
}
