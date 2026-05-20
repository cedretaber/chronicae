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

export const ANONYMOUS_HOUSE_ID: HouseId = 'h-anon' as HouseId

// v0.17.2: Province の bailiff が空席のときに当てる単一の placeholder Person ID。
// 旧版では Province ごとに新規 placeholder Person を作っていたが、これは
// AnonymousHouse.memberIds に死蔵 (累積) する原因になっていた (seed 1 で 6266 体)。
// 全 placeholder bailiff は singleton ID を共有する。kind === 'placeholder' で
// 判定する各種システムの挙動は変わらない。
export const PLACEHOLDER_PERSON_ID: PersonId = 'pe-anon-placeholder' as PersonId

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

export type LandContractIndex = {
  byProvince: Record<ProvinceId, LandContractId[]>
  byHolding: Record<HoldingId, LandContractId[]>
  byGranteePolity: Record<PolityId, LandContractId[]>
  byParent: Record<LandContractId, LandContractId | undefined>
}

export type ProvinceTerminalPolityCache = Record<ProvinceId, PolityId>

export type Holding = {
  id: HoldingId
  provinceId: ProvinceId
  kind: 'manor' | 'city'
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
  startYear: number
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
