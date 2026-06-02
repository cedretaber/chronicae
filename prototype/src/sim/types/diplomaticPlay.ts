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
  HoldingId,
  GoalId,
  AimId,
} from './ids'
import type { PoliticalActorRef } from './actor'
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
export type ActiveDiplomaticPlayStatus = 'active' | 'escalated'

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

export type DiplomaticDemand =
  | {
      kind: 'transfer_land_contract'
      holdingId: HoldingId
      toPolityId: PolityId
      beneficiaryActor?: PoliticalActorRef
    }
  | {
      kind: 'change_contract_tax_rate'
      holdingId: HoldingId
      landContractId: LandContractId
      newTaxRateToGrantor: number
    }
  | {
      kind: 'pay_wealth'
      from: PoliticalActorRef
      to: PoliticalActorRef
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
  | { kind: 'status_quo' }

// v0.30: DiplomaticIssue — immutable anchor for diplomatic play
export type TaxRevisionDirection = 'increase' | 'decrease'

export type LandClaimIssue = {
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
}

export type DiplomaticIssue = LandClaimIssue | ContractTaxRevisionIssue

// v0.30: DiplomaticOffer — mutable proposal for resolving an issue
export type DiplomaticOfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn'

export type DiplomaticOffer = {
  id: DiplomaticOfferId
  playId: DiplomaticPlayId
  proposedBy: PoliticalActorRef
  demands: DiplomaticDemand[]
  status: DiplomaticOfferStatus
  createdWeek: number
  reasonIds: DecisionReasonId[]
}

// v0.30: Offer validation
export type OfferInvalidReason =
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

export type DiplomaticPlay = {
  id: DiplomaticPlayId
  kind: DiplomaticPlayKind

  initiator: PoliticalActorRef
  target: PoliticalActorRef

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
