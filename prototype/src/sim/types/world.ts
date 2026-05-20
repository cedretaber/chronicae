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
  FactionId,
  FactionMembershipId,
  ActorIntentId,
  DiplomaticPlayId,
  StateRegionId,
  HoldingId,
  HoldingOfficeAssignmentId,
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
  PolityIndex,
  Holding,
  HoldingTerminalPolityCache,
  HoldingOfficeAssignment,
  HoldingOfficeIndex,
} from './landContract'
import type { Faction, FactionMembership, FactionIndex } from './faction'
import type { ActorIntent } from './actorIntent'
import type { DiplomaticPlay } from './diplomaticPlay'
import type { StateRegion } from './stateRegion'

export type WorldState = {
  currentYear: number
  currentWeekOfYear: number
  absoluteWeek: number
  provinces: Record<ProvinceId, Province>
  holdings: Record<HoldingId, Holding>
  states: Record<StateRegionId, StateRegion>
  polities: Record<PolityId, Polity>
  houses: Record<HouseId, House>
  persons: Record<PersonId, Person>
  activePlots: Record<PlotId, Plot>
  popGroups: Record<PopGroupId, PopGroup>
  organizationShares: Record<OrganizationShareId, OrganizationShare>
  officeAssignments: Record<OfficeAssignmentId, OfficeAssignment>
  landContracts: Record<LandContractId, LandContract>
  holdingOfficeAssignments: Record<HoldingOfficeAssignmentId, HoldingOfficeAssignment>
  holdingOfficeIndex: HoldingOfficeIndex
  shareIndex: ShareIndex
  officeIndex: OfficeIndex
  landContractIndex: LandContractIndex
  holdingTerminalPolityCache: HoldingTerminalPolityCache
  polityIndex: PolityIndex
  factions: Record<FactionId, Faction>
  factionMemberships: Record<FactionMembershipId, FactionMembership>
  factionIndex: FactionIndex
  // v0.18 Stage A §6.6
  actorIntents: Record<ActorIntentId, ActorIntent>
  diplomaticPlays: Record<DiplomaticPlayId, DiplomaticPlay>
  nextOrganizationShareId: number
  nextOfficeAssignmentId: number
  nextLandContractId: number
  nextHoldingOfficeAssignmentId: number
  nextFactionId: number
  nextFactionMembershipId: number
  // v0.18 Stage A §6.6
  nextActorIntentId: number
  nextDiplomaticPlayId: number
}

export type SimulationSession = {
  initialSeed: string
  currentState: WorldState
  rng: RngState
  eventHistory: SimEvent[]
}
