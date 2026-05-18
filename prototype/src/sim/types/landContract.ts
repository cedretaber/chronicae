import type {
  ProvinceId,
  PolityId,
  PersonId,
  HouseId,
  LandContractId,
  ProvinceOfficeAssignmentId,
} from './ids'

export type RootAuthorityId = string & { readonly __brand: 'RootAuthorityId' }

export const ROOT_WORLD: RootAuthorityId = 'root:world' as RootAuthorityId

export const ANONYMOUS_HOUSE_ID: HouseId = 'h-anon' as HouseId

export type LandContract = {
  id: LandContractId
  provinceId: ProvinceId
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
  byGranteePolity: Record<PolityId, LandContractId[]>
  byParent: Record<LandContractId, LandContractId | undefined>
}

export type ProvinceTerminalPolityCache = Record<ProvinceId, PolityId>

export type ProvinceOfficeRole = 'bailiff'

export type ProvinceOfficeAssignment = {
  id: ProvinceOfficeAssignmentId
  provinceId: ProvinceId
  role: ProvinceOfficeRole
  holderPersonId: PersonId
  appointingPolityId: PolityId
  active: boolean
  startYear: number
  startMonth: number
  unpaidCount: number
}

export type ProvinceOfficeIndex = {
  byProvince: Record<ProvinceId, ProvinceOfficeAssignmentId | undefined>
  byHolderPerson: Record<PersonId, ProvinceOfficeAssignmentId[]>
  byAppointingPolity: Record<PolityId, ProvinceOfficeAssignmentId[]>
}

export type PolityIndex = {
  byOwnerHouse: Record<HouseId, PolityId[]>
}
