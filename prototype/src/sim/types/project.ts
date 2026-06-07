import type {
  ProjectId,
  PressureId,
  PersonId,
  PolityId,
  HouseId,
  HoldingId,
  ProvinceId,
  LandContractId,
  AimId,
  DecisionReasonId,
  DiplomaticPlayId,
} from './ids'
import type { DecisionSubjectRef, EntityRef } from './goal'
import type { AbilityKey } from './person'
import type { PoliticalRightTargetRef } from './politicalRight'
import type { HoldingImprovementKind } from './holdingImprovement'
import type { PressureResponseStance } from './pressure'

export type ProjectStatus = 'active' | 'completed' | 'failed' | 'cancelled'

// v0.44 §5.3: Project が terminal になった理由。status を terminal に変更する全サイトで
// 必ずセットする (セット漏れは IntegrityCheck §12.2 違反。terminal Project は
// projectOutcomeSystem / flushTerminalEntities が同 tick 〜 4 週内に削除するため、
// 年末 integrity では検出できない — --integrity-per-system で検証する)。
export type ProjectTerminalReason =
  | 'completed'
  | 'deadline_expired'
  | 'stage_attempts_exceeded'
  | 'budget_exhausted'
  | 'duplicate_play'
  | 'opponent_too_strong'
  | 'no_supervisor'
  | 'owner_inactive'
  | 'aim_terminal'
  | 'play_terminal'

export type ProjectOrigin = { kind: 'aim'; aimId: AimId } | { kind: 'system'; reasonKey: string }

export type ProjectKind =
  | 'develop_holding'
  | 'acquire_political_right'
  | 'promote_policy_shift'
  | 'patronize_artist'
  | 'commission_chronicle'
  | 'acquire_land'
  | 'sell_land'
  | 'improve_contract_terms'
  | 'demand_tax_increase'
  | 'respond_to_pressure'
  // v0.44 §6: 個人鍛錬 (improve_ability aim の project 化)
  | 'personal_training'

export type BaseProject = {
  id: ProjectId
  owner: DecisionSubjectRef
  origin: ProjectOrigin
  kind: ProjectKind
  creatorPersonId: PersonId
  supervisorPersonId: PersonId
  parentProjectId?: ProjectId
  status: ProjectStatus
  // v0.44 §5.3: terminal status と同時にセットする (active 中は持たない)
  terminalReason?: ProjectTerminalReason
  progress: number
  targetProgress: number
  currentStageKey: ProjectStageKey
  stageAttemptCount?: number
  createdWeek: number
  deadlineWeek?: number
  reasonIds: DecisionReasonId[]
}

export type ProjectStageKey = string

export type ProjectStageType = 'immediate' | 'preparatory' | 'final'

export type ProjectStageEntry = {
  key: ProjectStageKey
  type: ProjectStageType
}

export type ProjectBudgetSource = { kind: 'owner' }

export type ProjectBudget = {
  required: number
  allocated: number
  remaining: number
  spent: number
  source: ProjectBudgetSource
}

export type DevelopHoldingProject = BaseProject & {
  kind: 'develop_holding'
  holdingId: HoldingId
  improvementKind: HoldingImprovementKind
  targetImprovementLevel: number
  budget: ProjectBudget
}

export type PromotePolicyShiftProject = BaseProject & {
  kind: 'promote_policy_shift'
  polityId: PolityId
  houseId: HouseId
  policyKey?: string
}

// v0.42 §13.2: PoliticalRight の取得。owner は House。rightKind は target から導出 (§4.2)。
export type AcquirePoliticalRightProject = BaseProject & {
  kind: 'acquire_political_right'
  polityId: PolityId
  target: PoliticalRightTargetRef
  budget: number
  spentBudget: number
}

export type PatronizeArtistProject = BaseProject & {
  kind: 'patronize_artist'
  houseId: HouseId
  budget: number
  spentBudget: number
  artistPersonId?: PersonId
}

export type CommissionChronicleProject = BaseProject & {
  kind: 'commission_chronicle'
  houseId: HouseId
  budget: number
  spentBudget: number
  subjectRef?: EntityRef
}

export type LandClaimProject = BaseProject & {
  kind: 'acquire_land' | 'sell_land'
  holdingId?: HoldingId
  provinceId?: ProvinceId
  counterpartyPolityId?: PolityId
  diplomaticPlayId?: DiplomaticPlayId
  preparation: number
  leverage: number
  commitment: number
}

export type ContractRevisionProject = BaseProject & {
  kind: 'improve_contract_terms' | 'demand_tax_increase'
  holdingId?: HoldingId
  landContractId?: LandContractId
  counterpartyPolityId?: PolityId
  desiredTaxRateToGrantor?: number
  diplomaticPlayId?: DiplomaticPlayId
  preparation: number
  leverage: number
  commitment: number
}

// v0.44 §6.3-6.4: owner/creator/supervisor/trainee は全て本人で一致させる (integrity §12.2)。
// budget は持たない (§6.7)。
export type PersonalTrainingProject = BaseProject & {
  kind: 'personal_training'
  owner: { kind: 'person'; id: PersonId }
  traineePersonId: PersonId
  trainingAbilityKey: AbilityKey
}

export type RespondToPressureProject = BaseProject & {
  kind: 'respond_to_pressure'
  pressureId: PressureId
  diplomaticPlayId?: DiplomaticPlayId
  stance?: PressureResponseStance
}

export type Project =
  | DevelopHoldingProject
  | PromotePolicyShiftProject
  | AcquirePoliticalRightProject
  | PatronizeArtistProject
  | CommissionChronicleProject
  | LandClaimProject
  | ContractRevisionProject
  | RespondToPressureProject
  | PersonalTrainingProject

export type ProjectIndex = {
  byOwner: Record<string, ProjectId[]>
  byAim: Record<string, ProjectId[]>
  byParentProject: Record<string, ProjectId[]>
  byCreatorPerson: Record<string, ProjectId[]>
  bySupervisorPerson: Record<string, ProjectId[]>
  byRelatedEntity: Record<string, ProjectId[]>
}
