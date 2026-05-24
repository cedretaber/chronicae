import type {
  GoalId,
  AimId,
  DecisionReasonId,
  PressureId,
  PolityId,
  HouseId,
  PersonId,
  ProvinceId,
  HoldingId,
  LandContractId,
  DiplomaticPlayId,
  StateRegionId,
  TaskId,
} from './ids'
import type { PoliticalActorRef } from './actor'
import type { OfficeRole } from './office'
import type { AbilityKey } from './person'
import type { TaskTargetRef } from './task'

// --- DecisionSubjectRef ---
export type DecisionSubjectRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
  | { kind: 'person'; id: PersonId }

export function decisionSubjectKey(ref: DecisionSubjectRef): string {
  return `${ref.kind}:${ref.id}`
}

// --- EntityRef (for Goal/Aim targets) ---
export type EntityRef =
  | { kind: 'polity'; id: PolityId }
  | { kind: 'house'; id: HouseId }
  | { kind: 'person'; id: PersonId }
  | { kind: 'state'; id: StateRegionId }
  | { kind: 'province'; id: ProvinceId }
  | { kind: 'holding'; id: HoldingId }
  | { kind: 'land_contract'; id: LandContractId }
  | { kind: 'aim'; id: AimId }
  | { kind: 'office'; organization: PoliticalActorRef; role: OfficeRole }
  | { kind: 'ability'; ability: AbilityKey }

// --- Goal ---
export type PolityGoalKind = 'external_expansion' | 'internal_development'
export type HouseGoalKind = 'expand_power_base' | 'preserve_power_base' | 'cultivate_prestige'
export type PersonGoalKind =
  | 'house_loyalty'
  | 'public_service'
  | 'personal_advancement'
  | 'wealth_building'
  | 'self_cultivation'
export type GoalKind = PolityGoalKind | HouseGoalKind | PersonGoalKind

export type ActiveGoalStatus = 'active'
export type TerminalGoalStatus = 'succeeded' | 'failed' | 'abandoned'
export type GoalStatus = ActiveGoalStatus | TerminalGoalStatus

export const TERMINAL_GOAL_STATUSES: ReadonlyArray<TerminalGoalStatus> = [
  'succeeded',
  'failed',
  'abandoned',
]

export type Goal = {
  id: GoalId
  owner: DecisionSubjectRef
  kind: GoalKind

  priority: number

  progress: number
  targetProgress: number

  createdWeek: number
  minimumUntilWeek: number
  lastReviewWeek: number
  nextReviewWeek: number

  status: GoalStatus
  reasonIds: DecisionReasonId[]
}

// --- Aim ---
export type PolityAimKind =
  | 'consolidate_province_holdings'
  | 'seize_weak_remote_holdings'
  | 'develop_owned_holding'
  | 'improve_owned_contract_terms'
  | 'demand_tax_increase_from_vassal'

export type HouseAimKind =
  | 'increase_polity_share'
  | 'steer_polity_external_expansion'
  | 'steer_polity_internal_development'
  | 'patronize_artist'
  | 'commission_chronicle'

export type PersonAimKind =
  | 'support_organization_aim'
  | 'increase_house_influence'
  | 'obtain_office'
  | 'retain_office'
  | 'accumulate_wealth'
  | 'improve_ability'
export type AimKind = PolityAimKind | HouseAimKind | PersonAimKind

export type AimOrigin = 'goal_driven' | 'pressure_response'

export type ActiveAimStatus = 'active'
export type TerminalAimStatus = 'succeeded' | 'failed' | 'abandoned'
export type AimStatus = ActiveAimStatus | TerminalAimStatus

export const TERMINAL_AIM_STATUSES: ReadonlyArray<TerminalAimStatus> = [
  'succeeded',
  'failed',
  'abandoned',
]

export type Aim = {
  id: AimId
  owner: DecisionSubjectRef

  goalId?: GoalId
  pressureId?: PressureId

  origin: AimOrigin
  kind: AimKind
  target?: EntityRef

  priority: number

  progress: number
  targetProgress: number

  createdWeek: number
  deadlineWeek: number

  lastProjectPreparedWeek?: number
  nextProjectAllowedWeek?: number

  activeDiplomaticPlayId?: DiplomaticPlayId
  activeTaskId?: TaskId
  waitingFor?: TaskTargetRef
  waitingReasonKey?: string
  blockedReasonKey?: string
  nextReviewWeek?: number
  successfulProjectCount: number
  failedProjectCount: number

  status: AimStatus
  reasonIds: DecisionReasonId[]
}

// --- DecisionReason ---
export type DecisionReason = {
  id: DecisionReasonId
  owner: DecisionSubjectRef
  summaryKey: string
  params?: Record<string, string | number>
  weight: number
  createdWeek: number
}

// --- Index types ---
export type GoalIndex = {
  byOwner: Record<string, GoalId[]>
}

export type AimIndex = {
  byOwner: Record<string, AimId[]>
  byGoal: Record<string, AimId[]>
}
