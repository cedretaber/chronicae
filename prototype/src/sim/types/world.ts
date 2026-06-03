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
  WarId,
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
  RegimentId,
  BattleId,
  ChronicleEntryId,
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
import type { HoldingImprovement, HoldingImprovementIndex } from './holdingImprovement'
import type { Project, ProjectIndex } from './project'
import type { DiplomaticPlay, DiplomaticOffer } from './diplomaticPlay'
import type { War, WarIndex } from './war'
import type { Regiment, RegimentIndex } from './regiment'
import type { Battle, BattleIndex } from './battle'
import type { Pressure, PressureIndex } from './pressure'
import type { ChronicleEntry, ChronicleIndex } from './chronicle'
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
  holdingImprovementIndex: HoldingImprovementIndex
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
  // v0.34 War
  wars: Record<WarId, War>
  warIndex: WarIndex
  // v0.36 Regiment / Battle
  regiments: Record<RegimentId, Regiment>
  regimentIndex: RegimentIndex
  nextRegimentId: number
  battles: Record<BattleId, Battle>
  battleIndex: BattleIndex
  nextBattleId: number
  // v0.29 Pressure
  pressures: Record<PressureId, Pressure>
  pressureIndex: PressureIndex
  // v0.38 Chronicle System (read-only historical archive; append-only, not used by simulation logic)
  chronicleEntries: Record<ChronicleEntryId, ChronicleEntry>
  chronicleIndex: ChronicleIndex
  nextChronicleEntryId: number
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
  // v0.34
  nextWarId: number
  // v0.29
  nextPressureId: number
  // v0.23
  nextTaskId: number
  nextPersonActivityLogId: number
  // v0.24
  nextPopGroupId: number
  // v0.32
  nextClanId: number
  // 調査 §4.5: person/house/polity の next index を永続化 (毎 tick の O(n) スキャン廃止)。
  // person は worldgen と runtime で `pe-` を共有、house/polity は worldgen `h-`/`c-` と
  // runtime `dh-`/`dp-` で別名前空間 (worldgen 直後はそれぞれ 0)。
  // optional: production (worldgen) は必ずセットし createTickContext は永続値を読む (perf)。
  // 未設定の WorldState (テスト fixture 等) は createTickContext が従来の scan に fallback する
  // ため挙動は完全に保たれる。
  nextPersonIndex?: number
  nextHouseIndex?: number
  nextPolityIndex?: number
}

export type SimulationSession = {
  initialSeed: string
  currentState: WorldState
  rng: RngState
  eventHistory: SimEvent[]
}
