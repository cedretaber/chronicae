import type {
  DiplomaticPlayId,
  DiplomaticOfferId,
  DecisionReasonId,
  ProjectId,
  TaskId,
  PersonId,
  ProvinceId,
  PolityId,
  LandContractId,
  LandContractDefaultId,
  HoldingId,
  GoalId,
  AimId,
} from './ids'
import type { OrganizationRef } from './office'
import type { PopClass } from './popGroup'

// v0.18 Stage A §6.4 / §6.5

// v0.18 Stage F: land_purchase + land_transfer_demand を land_claim に統合。
//   外交劇は中立な「土地請求」として開始し、交渉プロセスと outcome (補償あり妥協 /
//   補償なし妥協 / 武力奪取) で結果の色を表現する。
export type DiplomaticPlayKind = 'land_claim' | 'contract_tax_revision' | 'revolt_negotiation'

// v0.18 Stage D 更新:
//   'escalated' を ActiveDiplomaticPlayStatus に追加。
//   この status は diplomaticPlaySystem が tension >= escalationThreshold を検出したとき
//   設定する非進行中間状態。同 tick 内の ConflictResolutionSystem が拾い上げ、
//   'resolved_by_conflict' (terminal) に置換する。maxConflictsResolvedPerTick の
//   上限で resolve 漏れがあった場合、'escalated' は次 tick に持ち越される (それでも
//   IntegrityCheck §20 を通る非 terminal 扱い)。
type ActiveDiplomaticPlayStatus = 'active' | 'escalated'

export type TerminalDiplomaticPlayStatus =
  | 'settled'
  | 'failed'
  | 'resolved_by_conflict'
  | 'cancelled'

export type DiplomaticPlayStatus = ActiveDiplomaticPlayStatus | TerminalDiplomaticPlayStatus

export const TERMINAL_DIPLOMATIC_PLAY_STATUSES: ReadonlyArray<TerminalDiplomaticPlayStatus> = [
  'settled',
  'failed',
  'resolved_by_conflict',
  'cancelled',
]

// v0.44 §7.2: terminal 化サイトで status と同時にセットする外交劇の結末分類。
// resolved_by_conflict には複数の意味 (対外戦争化・内部叛乱の蜂起成功/鎮圧) が混ざるため
// terminalOutcome で明確に分ける。セット漏れは IntegrityCheck §12.3 違反
// (terminal play は cleanupTerminalDiplomacy が同 tick で削除するため、
// 年末 integrity では検出できない — --integrity-per-system で検証する)。
export type DiplomaticPlayTerminalOutcome =
  | 'demands_met'
  | 'status_quo'
  | 'escalated_to_war'
  | 'revolt_succeeded'
  | 'revolt_suppressed'
  | 'failed'
  | 'voided'

export type DiplomaticDemand =
  | {
      kind: 'transfer_land_contract'
      holdingId: HoldingId
      toPolityId: PolityId
      beneficiaryActor?: OrganizationRef
    }
  | {
      kind: 'change_contract_tax_rate'
      holdingId: HoldingId
      landContractId: LandContractId
      newTaxRateToGrantor: number
      // v0.53 Phase 4: enforce_land_contract_default 経由なら、適用時にこの LandContractDefault を resolved にする。
      resolvesLandContractDefaultId?: LandContractDefaultId
    }
  | {
      kind: 'pay_wealth'
      from: OrganizationRef
      to: OrganizationRef
      amount: number
    }
  | {
      kind: 'popular_tax_relief'
      holdingId: HoldingId
      targetContractId: LandContractId
      currentTaxRate: number
      demandedTaxRate: number
      claimantPopClass: PopClass
    }
  // v0.48: 民衆反乱の「代官排除」要求。住民が holding の代官 (bailiff person) の罷免を求める。
  | {
      kind: 'bailiff_dismissal'
      holdingId: HoldingId
      targetContractId: LandContractId
      claimantPopClass: PopClass
      bailiffPersonId: PersonId
    }
  // v0.48: 民衆反乱の「独立」要求。領主家への悪感情が蓄積した住民が武装蜂起で独立を目指す。
  //   交渉による妥結経路を持たず escalation (seizure→war) に直行する。
  | {
      kind: 'secession'
      holdingId: HoldingId
      targetContractId: LandContractId
      claimantPopClass: PopClass
    }
  | { kind: 'status_quo' }

// v0.30: DiplomaticIssue — immutable anchor for diplomatic play
type TaxRevisionDirection = 'increase' | 'decrease'

type LandClaimIssue = {
  kind: 'land_claim'
  holdingId: HoldingId
  provinceId: ProvinceId
}

export type ContractTaxRevisionIssue = {
  kind: 'contract_tax_revision'
  holdingId: HoldingId
  landContractId: LandContractId
  baseTaxRateToGrantor: number
  desiredTaxRateToGrantor: number
  direction: TaxRevisionDirection
  // v0.53 Phase 4: enforce_land_contract_default 由来の play なら、解消対象の default を指す。
  //   war 化時に WarGoal へ、和平/受諾時に demand 経由で resolved に伝播する。
  resolvesLandContractDefaultId?: LandContractDefaultId
}

type DiplomaticIssue = LandClaimIssue | ContractTaxRevisionIssue

// v0.30: DiplomaticOffer — mutable proposal for resolving an issue
type DiplomaticOfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn'

export type DiplomaticOffer = {
  id: DiplomaticOfferId
  playId: DiplomaticPlayId
  proposedBy: OrganizationRef
  demands: DiplomaticDemand[]
  status: DiplomaticOfferStatus
  createdWeek: number
  reasonIds: DecisionReasonId[]
}

// v0.30: Offer validation
type OfferInvalidReason =
  | 'missing_offer'
  | 'offer_not_pending'
  | 'wrong_play'
  | 'missing_actor'
  | 'insufficient_funds'
  | 'missing_holding'
  | 'missing_land_contract'
  | 'stale_land_contract'
  | 'invalid_demand'
  | 'unsupported_demand_combination'

export type OfferValidationResult = { valid: true } | { valid: false; reason: OfferInvalidReason }

// v0.30: Offer evaluation
export type OfferEvaluation = {
  accepted: boolean
  score: number
  progressDelta: number
  tensionDelta: number
  reasonKey: string
  params?: Record<string, string | number>
}

// v0.43 §5.1: DiplomaticPlay の supporter (primary 以外の支持 Polity)。
export type DiplomaticPlaySupporter = {
  actor: OrganizationRef // v0.43 では actor.kind === 'polity' のみ
  joinedWeek: number
  commitment: number // 0..100。v0.43 では joinScore 由来の固定値でよい
  // §5.1a: 前方互換フィールド。v0.43 では書き込みサイトなし・常に undefined。
  contributionScore?: number
}

// v0.43 §6.1: supporter を追加する side の指定。
export type DiplomaticPlaySideKey = 'initiator' | 'target'

export type DiplomaticPlay = {
  id: DiplomaticPlayId
  kind: DiplomaticPlayKind

  initiator: OrganizationRef
  target: OrganizationRef

  // v0.43 §5.2: 各 side を支持する Polity supporter (required・新規作成時は空配列)。
  initiatorSupporters: DiplomaticPlaySupporter[]
  targetSupporters: DiplomaticPlaySupporter[]

  originProjectId?: ProjectId

  // v0.22 Goal/Aim connection
  goalId?: GoalId
  aimId?: AimId

  primaryDemand?: DiplomaticDemand

  // v0.30: issue anchor + offer tracking
  issue?: DiplomaticIssue
  currentOfferId?: DiplomaticOfferId
  lastEvaluatedOfferId?: DiplomaticOfferId
  lastRejectedOfferId?: DiplomaticOfferId
  offerHistoryIds: DiplomaticOfferId[]

  status: DiplomaticPlayStatus
  // v0.44 §7.2: terminal status と同時にセットする (active/escalated 中は持たない)
  terminalOutcome?: DiplomaticPlayTerminalOutcome

  startedWeek: number
  deadlineWeek: number

  progress: number // 0..100
  tension: number // 0..100

  // v0.23 Phase D: delegate persons
  initiatorDelegatePersonId?: PersonId
  targetDelegatePersonId?: PersonId

  // v0.23 Phase D: negotiation parameters (per side, 0..100)
  initiatorPreparation: number
  initiatorLeverage: number
  initiatorCommitment: number
  targetPreparation: number
  targetLeverage: number
  targetCommitment: number

  // v0.23 Phase D: active Tasks
  initiatorActiveTaskIds: TaskId[]
  targetActiveTaskIds: TaskId[]
}
