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
import type { PoliticalRightTargetRef } from './politicalRight'
import type { OfficeRole, OrganizationRef } from './office'
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
  | { kind: 'office'; organization: OrganizationRef; role: OfficeRole }
  // v0.42 §13.3: acquire_political_right aim の target。politicalRightTargetKey が
  // entityRefKey に入るため、同一 target への重複 aim は aimSlotKey で防がれる。
  | { kind: 'political_right_target'; target: PoliticalRightTargetRef }
  | { kind: 'ability'; ability: AbilityKey }

// --- Goal ---
export type PolityGoalKind = 'external_expansion' | 'internal_development'
export type HouseGoalKind =
  | 'expand_power_base'
  | 'preserve_power_base'
  | 'cultivate_prestige'
  // v0.47 §3.2: 自家の複数 Polity / LandContract を主要 Polity に集約し一円支配を目指す
  | 'consolidate_domain'
  // v0.51 陰謀リファイン: 不満家が陰謀 (影響力毀損・任命権失効・分家統制) を追求する covert goal。
  //   スコアは computeConspiracyDrive (旧 plotTendency 移植 + cooldown ゲート) で決まる。
  | 'pursue_covert_agenda'
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
  | 'eliminate_overlord_contract'
  | 'eliminate_vassal_contract'
  // v0.47 §3.1: rank 5→4 / 4→3 / 3→2 の陞爵を目指す (rank 2→1 は対象外)
  | 'seek_rank_promotion'

export type HouseAimKind =
  // v0.42 §13.2: 具体的な政治権利の取得 (influence は read-model — 旧 increase_polity_share の置換)
  | 'acquire_political_right'
  | 'steer_polity_external_expansion'
  | 'steer_polity_internal_development'
  | 'patronize_artist'
  | 'commission_chronicle'
  // 影響力個人中心化 Phase 1b: 運動 (家がメンバーを国に推薦して influence を積む)
  | 'start_movement_campaign'
  // v0.47 §3.3: 自家内で完結する LandContract chain の整理 (一円支配集約)
  | 'consolidate_owned_polities'
  // v0.51 陰謀リファイン: 同 Polity 内ライバル (家/人物) の影響力を毀損する陰謀 (InfluenceModifier 生成)
  | 'undermine_rival_influence'
  // v0.51 陰謀リファイン: ライバルの PoliticalRight (任命権・連隊保有権) を失効させ国に戻す陰謀
  | 'revoke_rival_right'
  // v0.51 陰謀リファイン: 自家の分家 (cadet) の当主を交代させる王朝統制陰謀 (旧 replace_house_leader plot)
  | 'intervene_cadet_succession'

export type PersonAimKind =
  | 'support_organization_aim'
  | 'increase_house_influence'
  | 'obtain_office'
  | 'retain_office'
  | 'accumulate_wealth'
  | 'improve_ability'
  // v0.47 §3.4: 分封願い (無家=新House+rank5 / 有家=分家+rank5)
  | 'request_land_grant'
  // v0.47 §3.4: 宗家 Polity 譲渡を求め分家創設を目指す
  | 'establish_cadet_branch'
  // v0.47 §3.4: established commonwealth 役職を持つ無家人物が財産基盤で House 創設
  | 'found_republic_house'
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

  // 調査 §1.5: terminal aim の goal progress 加算を冪等化するフラグ。
  // goalOutcomeSystem は terminal aim を毎 tick 走査するため、外交系 Project が
  // aim を保持して cleanup されない間、同じ aim の progressDelta が再加算されていた
  // (実測 最大 11x)。一度加算したら true にして二重加算を防ぐ。
  goalProgressApplied?: boolean
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
