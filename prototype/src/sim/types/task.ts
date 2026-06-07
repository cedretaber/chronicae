import type {
  TaskId,
  PersonActivityLogId,
  PersonId,
  AimId,
  ProjectId,
  DiplomaticPlayId,
  DecisionReasonId,
  HoldingOfficeAssignmentId,
} from './ids'
import type { DecisionSubjectRef, EntityRef } from './goal'
import type { AbilityKey } from './person'
import type { ProjectKind } from './project'

// --- TaskTargetRef ---
export type TaskTargetRef =
  | { kind: 'aim'; id: AimId }
  | { kind: 'project'; id: ProjectId }
  | { kind: 'diplomatic_play'; id: DiplomaticPlayId }
  | { kind: 'holding_office_assignment'; id: HoldingOfficeAssignmentId }

export function targetRefKey(ref: TaskTargetRef): string {
  return `${ref.kind}:${ref.id}`
}

// --- TaskStatus ---
export type ActiveTaskStatus = 'active'
export type TerminalTaskStatus = 'succeeded' | 'failed' | 'cancelled'
export type TaskStatus = ActiveTaskStatus | TerminalTaskStatus

export const TERMINAL_TASK_STATUSES: ReadonlyArray<TerminalTaskStatus> = [
  'succeeded',
  'failed',
  'cancelled',
]

// --- TaskOutcomeKind ---
export type TaskOutcomeKind = 'success' | 'failure' | 'partial'

// --- TaskKind ---
export type TaskKind =
  | 'support_organization_plan'
  | 'promote_house_influence'
  | 'perform_office_duties'
  | 'seek_office_support'
  | 'display_competence'
  | 'defend_office_position'
  | 'manage_accounts'
  | 'seek_profitable_assignment'
  | 'study_law'
  | 'study_accounts'
  | 'practice_arms'
  | 'courtly_training'
  | 'secure_internal_support'
  | 'arrange_patronage'
  | 'commission_chronicle_work'
  | 'prepare_argument'
  | 'gather_claim_evidence'
  | 'negotiate_terms'
  | 'pressure_counterparty'
  | 'offer_compromise'
  | 'undermine_counterparty_position'
  | 'collect_holding_revenue'
  | 'prepare_project'
  | 'advance_project'
  // v0.43 §7: DiplomaticPlay の supporter 勧誘 (LIGHT・charisma)
  | 'seek_diplomatic_support'

// --- Task ---
export type Task = {
  id: TaskId
  owner: DecisionSubjectRef
  assigneePersonId: PersonId
  kind: TaskKind
  targetRef: TaskTargetRef
  priority: number
  actionCost: number
  effortRequired: number
  effortDone: number
  createdWeek: number
  deadlineWeek?: number
  status: TaskStatus
  reasonIds: DecisionReasonId[]
  difficulty: number
  relevantAbility: AbilityKey
}

// --- TaskIndex ---
export type TaskIndex = {
  byAssignee: Record<string, TaskId[]>
  byOwner: Record<string, TaskId[]>
  byTarget: Record<string, TaskId[]>
}

// --- WaitingAimIndex ---
// AimId list for aims in waiting state (waitingReasonKey set).
// Maintained by TaskSystem to avoid scanning all aims each tick.
export type WaitingAimIndex = AimId[]

// --- PersonActivityLog ---
export type PersonActivityKind =
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'task_expired'
  | 'project_completed'
  | 'project_failed'

export type BailiffRevenueTaskStatus = 'completed' | 'none'

type TaskActivityKind = 'task_completed' | 'task_failed' | 'task_cancelled' | 'task_expired'

type PersonActivityLogBase = {
  id: PersonActivityLogId
  personId: PersonId
  week: number
  relatedRefs: EntityRef[]
  summaryKey: string
  params?: Record<string, string | number>
  importance: number
}

export type TaskActivityLog = PersonActivityLogBase & {
  kind: TaskActivityKind
  outcome: TaskOutcomeKind
  taskKind: TaskKind
  sourceRef?: TaskTargetRef
}

export type ProjectActivityLog = PersonActivityLogBase & {
  kind: 'project_completed' | 'project_failed'
  projectKind: ProjectKind
  sourceRef: { kind: 'project'; id: ProjectId }
}

export type PersonActivityLog = TaskActivityLog | ProjectActivityLog

export type PersonActivityLogIndex = {
  byPerson: Record<string, PersonActivityLogId[]>
}
