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
  GoalId,
  AimId,
  DecisionReasonId,
  TaskId,
  PersonActivityLogId,
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
  // v0.22 Goal/Aim system
  goals: Record<GoalId, Goal>
  aims: Record<AimId, Aim>
  decisionReasons: Record<DecisionReasonId, DecisionReason>
  goalIndex: GoalIndex
  aimIndex: AimIndex
  diplomaticPlays: Record<DiplomaticPlayId, DiplomaticPlay>
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
  // v0.18 Stage A §6.6
  nextActorIntentId: number
  nextDiplomaticPlayId: number
  // v0.23
  nextTaskId: number
  nextPersonActivityLogId: number
}

export type SimulationSession = {
  initialSeed: string
  currentState: WorldState
  rng: RngState
  eventHistory: SimEvent[]
}
