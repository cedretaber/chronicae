import type { PolityId, HouseId, PersonId, OrganizationShareId, OfficeAssignmentId } from './ids'

export type OrganizationKind = 'polity' | 'house'

// 組織 (polity / house) への共通参照。office / share の所属先であると同時に、
// 外交・戦争・叛乱の主体 (旧 PoliticalActorRef、v0.41 で統合) としても用いる。
// 型としては polity と house を両方サポートするが、外交・戦争では実動の Intent 生成・
// DiplomaticPlay initiator として有効なのは polity のみ。house actor は selector の
// 対応だけ用意し、IntentGenerationSystem から生成は行わない (spec §8.7)。
export type OrganizationRef = { kind: 'polity'; id: PolityId } | { kind: 'house'; id: HouseId }

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
