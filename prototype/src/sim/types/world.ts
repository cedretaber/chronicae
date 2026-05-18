import type { RngState } from '../rng/rng'
import type {
  ProvinceId,
  PolityId,
  HouseId,
  PersonId,
  PlotId,
  PopGroupId,
  OrganizationShareId,
  OfficeAssignmentId,
  LandContractId,
  ProvinceOfficeAssignmentId,
  FactionId,
  FactionMembershipId,
} from './ids'
import type { Province } from './province'
import type { Polity } from './polity'
import type { House } from './house'
import type { Person } from './person'
import type { Plot } from './plot'
import type { SimEvent } from './event'
import type { PopGroup } from './popGroup'
import type { OrganizationShare, OfficeAssignment, ShareIndex, OfficeIndex } from './office'
import type {
  LandContract,
  LandContractIndex,
  ProvinceTerminalPolityCache,
  ProvinceOfficeAssignment,
  ProvinceOfficeIndex,
  PolityIndex,
} from './landContract'
import type { Faction, FactionMembership, FactionIndex } from './faction'

export type WorldState = {
  currentYear: number
  currentMonth: number
  provinces: Record<ProvinceId, Province>
  polities: Record<PolityId, Polity>
  houses: Record<HouseId, House>
  persons: Record<PersonId, Person>
  activePlots: Record<PlotId, Plot>
  popGroups: Record<PopGroupId, PopGroup>
  organizationShares: Record<OrganizationShareId, OrganizationShare>
  officeAssignments: Record<OfficeAssignmentId, OfficeAssignment>
  landContracts: Record<LandContractId, LandContract>
  provinceOfficeAssignments: Record<ProvinceOfficeAssignmentId, ProvinceOfficeAssignment>
  shareIndex: ShareIndex
  officeIndex: OfficeIndex
  landContractIndex: LandContractIndex
  provinceTerminalPolityCache: ProvinceTerminalPolityCache
  provinceOfficeIndex: ProvinceOfficeIndex
  polityIndex: PolityIndex
  factions: Record<FactionId, Faction>
  factionMemberships: Record<FactionMembershipId, FactionMembership>
  factionIndex: FactionIndex
  nextOrganizationShareId: number
  nextOfficeAssignmentId: number
  nextLandContractId: number
  nextProvinceOfficeAssignmentId: number
  nextFactionId: number
  nextFactionMembershipId: number
}

export type SimulationSession = {
  initialSeed: string
  currentState: WorldState
  rng: RngState
  eventHistory: SimEvent[]
}
