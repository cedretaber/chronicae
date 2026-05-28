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
  ProjectId,
  DiplomaticPlayId,
  DiplomaticOfferId,
  PressureId,
  StateRegionId,
  HoldingId,
  HoldingOfficeAssignmentId,
  HoldingImprovementId,
  GoalId,
  AimId,
  DecisionReasonId,
  TaskId,
  PersonActivityLogId,
  ClanId,
} from './ids'
import type { Province } from './province'
import type { Polity } from './polity'
import type { House } from './house'
import type { Person } from './person'
import type { Plot } from './plot'
import type { SimEvent } from './event'
import type { PopGroup, PopIndex } from './popGroup'
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
import type { Clan } from './clan'
import type { HoldingImprovement } from './holdingImprovement'
import type { Project, ProjectIndex } from './project'
import type { DiplomaticPlay, DiplomaticOffer } from './diplomaticPlay'
import type { Pressure, PressureIndex } from './pressure'
import type { StateRegion } from './stateRegion'
import type { Goal, Aim, DecisionReason, GoalIndex, AimIndex } from './goal'
import type {
  Task,
  TaskIndex,
  PersonActivityLog,
  PersonActivityLogIndex,
  AbilityTrainingExperience,
  WaitingAimIndex,
} from './task'

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
  livingPersonIds: PersonId[]
  activePlots: Record<PlotId, Plot>
  popGroups: Record<PopGroupId, PopGroup>
  popIndex: PopIndex
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
  // v0.32 Clan
  clans: Record<ClanId, Clan>
  // v0.27 HoldingImprovement
  holdingImprovements: Record<HoldingImprovementId, HoldingImprovement>
  holdingImprovementIndex: { byHolding: Record<string, HoldingImprovementId[]> }
  nextHoldingImprovementId: number
  // v0.26 Project system
  projects: Record<ProjectId, Project>
  projectIndex: ProjectIndex
  // v0.22 Goal/Aim system
  goals: Record<GoalId, Goal>
  aims: Record<AimId, Aim>
  decisionReasons: Record<DecisionReasonId, DecisionReason>
  goalIndex: GoalIndex
  aimIndex: AimIndex
  diplomaticPlays: Record<DiplomaticPlayId, DiplomaticPlay>
  diplomaticOffers: Record<DiplomaticOfferId, DiplomaticOffer>
  // v0.29 Pressure
  pressures: Record<PressureId, Pressure>
  pressureIndex: PressureIndex
  // v0.23 Task/ActivityLog
  tasks: Record<TaskId, Task>
  taskIndex: TaskIndex
  personActivityLogs: Record<PersonActivityLogId, PersonActivityLog>
  personActivityLogIndex: PersonActivityLogIndex
  personTrainingExperience: Record<PersonId, AbilityTrainingExperience>
  waitingAimIds: WaitingAimIndex
  // v0.22
  nextGoalId: number
  nextAimId: number
  nextDecisionReasonId: number
  nextOrganizationShareId: number
  nextOfficeAssignmentId: number
  nextLandContractId: number
  nextHoldingOfficeAssignmentId: number
  nextFactionId: number
  nextFactionMembershipId: number
  // v0.26
  nextProjectId: number
  nextDiplomaticPlayId: number
  nextDiplomaticOfferId: number
  // v0.29
  nextPressureId: number
  // v0.23
  nextTaskId: number
  nextPersonActivityLogId: number
  // v0.24
  nextPopGroupId: number
  // v0.32
  nextClanId: number
}

export type SimulationSession = {
  initialSeed: string
  currentState: WorldState
  rng: RngState
  eventHistory: SimEvent[]
}
