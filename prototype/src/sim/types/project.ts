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
import type { PolityRank } from './polity'
import type { AbilityKey } from './person'
import type { PoliticalRightTargetRef } from './politicalRight'
import type { InfluenceModifierTargetRef } from './influenceModifier'
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
  // v0.47 §6.2: owner Polity が titular 化したため territorial 前提の Project を打ち切る
  | 'owner_titularized'

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
  // 影響力個人中心化 Phase 1b: 運動 (家が資金で家メンバーを国に推薦し influence を積む)
  | 'movement_campaign'
  // v0.47 §3.5 称号・分封・領邦再編。budget を持たない petition Project 群
  // (解決は projectStageSystem.resolveImmediateStage の finalize_* ハンドラ・§4.4)。
  | 'request_rank_promotion'
  | 'request_land_grant'
  | 'request_cadet_branch_title_transfer'
  | 'republic_house_foundation'
  | 'consolidate_internal_contracts'
  // v0.51 陰謀リファイン: 影響力毀損陰謀。owner=House、target=同 Polity 内ライバル (家/人物)。
  | 'undermine_influence'

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

// v0.47 §5 陞爵 Project。owner = 陞爵対象 Polity。budget なし (§4.3)。
// approverPersonId は SOFT 同意者 (donor polity leader)。全 grantor が root なら undefined = auto-grant。
export type RequestRankPromotionProject = BaseProject & {
  kind: 'request_rank_promotion'
  owner: { kind: 'polity'; id: PolityId }
  polityId: PolityId
  newRank: PolityRank
  approverPersonId?: PersonId
}

// v0.47 §8-9 分封 Project。owner = 請願人物。budget なし。
// parentHouseId === undefined = 無家人物 (新 House)、!== undefined = 有家人物 (分家)。
export type RequestLandGrantProject = BaseProject & {
  kind: 'request_land_grant'
  owner: { kind: 'person'; id: PersonId }
  petitionerPersonId: PersonId
  donorPolityId: PolityId
  targetHoldingId: HoldingId
  parentHouseId?: HouseId
  approverPersonId?: PersonId
}

// v0.47 §11 Polity 譲渡による分家創設 Project。owner = 請願人物 (低継承権)。
// SOFT 同意は HouseShare holder の加重支持で判定 (§11.7)。
export type RequestCadetBranchTitleTransferProject = BaseProject & {
  kind: 'request_cadet_branch_title_transfer'
  owner: { kind: 'person'; id: PersonId }
  petitionerPersonId: PersonId
  parentHouseId: HouseId
  targetPolityId: PolityId
}

// v0.47 §13 共和国 House 創設 Project。owner = established commonwealth 役職を持つ無家人物。
export type RepublicHouseFoundationProject = BaseProject & {
  kind: 'republic_house_foundation'
  owner: { kind: 'person'; id: PersonId }
  petitionerPersonId: PersonId
  commonwealthPolityId: PolityId
}

// v0.47 §12 一円支配集約 Project。owner = 集約する House。
// sinkPolityId = 集約先 (最上位 territorial Polity)。
export type ConsolidateInternalContractsProject = BaseProject & {
  kind: 'consolidate_internal_contracts'
  owner: { kind: 'house'; id: HouseId }
  houseId: HouseId
  sinkPolityId: PolityId
}

// v0.51 陰謀リファイン: 影響力毀損 Project。owner = 陰謀を企てる House。
// target = 同 Polity 内のライバル (家 / 人物)。budget なし (v1 無料)。完了で InfluenceModifier
// (負 delta) を生成する (§3.2)。supervisor の insight が Task 進捗・成否を決める。
export type UndermineInfluenceProject = BaseProject & {
  kind: 'undermine_influence'
  owner: { kind: 'house'; id: HouseId }
  polityId: PolityId
  target: InfluenceModifierTargetRef
}

export type RespondToPressureProject = BaseProject & {
  kind: 'respond_to_pressure'
  pressureId: PressureId
  diplomaticPlayId?: DiplomaticPlayId
  stance?: PressureResponseStance
}

// 影響力個人中心化 Phase 1b: 運動 Project。
// owner = 資金を出す家 ({kind:'house'})。sponsoredPersonId = 推薦された家メンバー (= supervisor
// = 受益者)。完遂で sponsoredPersonId に dual-tag 評判 (owner=house→Share / target=polity→influence)
// が付き、個人の influence が上がる。fundingHouseId は owner.id と同一なので持たない (§redesign)。
export type MovementCampaignProject = BaseProject & {
  kind: 'movement_campaign'
  owner: { kind: 'house'; id: HouseId }
  targetPolityId: PolityId
  sponsoredPersonId: PersonId
  budget: number
  spentBudget: number
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
  | MovementCampaignProject
  | RequestRankPromotionProject
  | RequestLandGrantProject
  | RequestCadetBranchTitleTransferProject
  | RepublicHouseFoundationProject
  | ConsolidateInternalContractsProject
  | UndermineInfluenceProject

export type ProjectIndex = {
  byOwner: Record<string, ProjectId[]>
  byAim: Record<string, ProjectId[]>
  byParentProject: Record<string, ProjectId[]>
  byCreatorPerson: Record<string, ProjectId[]>
  bySupervisorPerson: Record<string, ProjectId[]>
  byRelatedEntity: Record<string, ProjectId[]>
}
