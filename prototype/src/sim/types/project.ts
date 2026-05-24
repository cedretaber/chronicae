import type {
  ProjectId,
  PersonId,
  PolityId,
  HouseId,
  HoldingId,
  ProvinceId,
  LandContractId,
  AimId,
  DecisionReasonId,
} from './ids'
import type { DecisionSubjectRef, EntityRef } from './goal'
import type { HoldingImprovementKind } from './holdingImprovement'

export type ProjectStatus = 'active' | 'completed' | 'failed' | 'cancelled'

export type ProjectOrigin = { kind: 'aim'; aimId: AimId } | { kind: 'system'; reasonKey: string }

export type ProjectKind =
  | 'develop_holding'
  | 'expand_polity_share'
  | 'promote_policy_shift'
  | 'patronize_artist'
  | 'commission_chronicle'
  | 'acquire_land'
  | 'sell_land'
  | 'improve_contract_terms'
  | 'demand_tax_increase'

export type BaseProject = {
  id: ProjectId
  owner: DecisionSubjectRef
  origin: ProjectOrigin
  kind: ProjectKind
  creatorPersonId: PersonId
  supervisorPersonId: PersonId
  parentProjectId?: ProjectId
  status: ProjectStatus
  progress: number
  targetProgress: number
  createdWeek: number
  deadlineWeek?: number
  reasonIds: DecisionReasonId[]
}

export type ProjectStageKey = 'find_supervisor' | 'secure_budget' | 'execute_project'

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
  currentStageKey: ProjectStageKey
  budget: ProjectBudget
}

export type ExpandPolityShareProject = BaseProject & {
  kind: 'expand_polity_share'
  polityId: PolityId
  houseId: HouseId
  budget: number
  spentBudget: number
}

export type PromotePolicyShiftProject = BaseProject & {
  kind: 'promote_policy_shift'
  polityId: PolityId
  houseId: HouseId
  policyKey?: string
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
  preparation: number
  leverage: number
  commitment: number
}

export type Project =
  | DevelopHoldingProject
  | ExpandPolityShareProject
  | PromotePolicyShiftProject
  | PatronizeArtistProject
  | CommissionChronicleProject
  | LandClaimProject
  | ContractRevisionProject

export type ProjectIndex = {
  byOwner: Record<string, ProjectId[]>
  byAim: Record<string, ProjectId[]>
  byParentProject: Record<string, ProjectId[]>
  byCreatorPerson: Record<string, ProjectId[]>
  bySupervisorPerson: Record<string, ProjectId[]>
  byRelatedEntity: Record<string, ProjectId[]>
}
