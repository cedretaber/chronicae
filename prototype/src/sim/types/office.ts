import type { CountryId, HouseId, PersonId, OrganizationShareId, OfficeAssignmentId } from './ids'

export type OrganizationKind = 'country' | 'house'

export type OrganizationRef = { kind: 'country'; id: CountryId } | { kind: 'house'; id: HouseId }

export type ShareHolderRef = { kind: 'person'; id: PersonId } | { kind: 'house'; id: HouseId }

export type OrganizationShare = {
  id: OrganizationShareId
  organization: OrganizationRef
  holder: ShareHolderRef
  rawPower: number // >= 0
}

export type OfficeRole = 'leader' | 'administrator' | 'treasurer' | 'military' | 'advisor'

export type OfficeAssignment = {
  id: OfficeAssignmentId
  organization: OrganizationRef
  role: OfficeRole
  holderPersonId: PersonId
  active: boolean
  startYear: number
  unpaidCount: number
}

export type OfficeDefinition = {
  organizationKind: OrganizationKind
  role: OfficeRole
  displayName: string
  maxHolders: number
  baseSalary: number
  baseAuthorityPower: number
  baseDignityPower: number
  adminLoad: number
  coordinationLoad: number
}

export type ShareIndex = {
  byOrganization: Record<string, OrganizationShareId[]>
  byHolder: Record<string, OrganizationShareId[]>
}

export type OfficeIndex = {
  byOrganization: Record<string, OfficeAssignmentId[]>
  byHolderPerson: Record<string, OfficeAssignmentId[]>
}
