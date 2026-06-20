import type {
  LandContractDefaultId,
  LandContractId,
  HoldingId,
  PolityId,
  ProjectId,
  DecisionReasonId,
} from './ids'

// v0.53: LandContract chain に基づく上納義務が履行されていない状態。spec §5。
//   tax_default = 通常の契約不履行 (上納拒否)、revolt_independence = 反乱独立占拠 (Phase 3)。
export type LandContractDefaultOrigin = 'tax_default' | 'revolt_independence'

export type LandContractDefaultStatus = 'active' | 'resolved' | 'legalized' | 'cancelled'

export type LandContractDefault = {
  id: LandContractDefaultId
  status: LandContractDefaultStatus
  origin: LandContractDefaultOrigin

  holdingId: HoldingId

  occupiedByPolityId: PolityId
  claimantPolityId: PolityId

  // A1: 必須。tax_default では対象 terminal contract、revolt_independence では nominal occupation
  //   contract を指す。LandRevenue の実効 0 はこの contract を byContract で引いて適用する。
  targetLandContractId: LandContractId

  originalGrantorPolityId?: PolityId
  originalGranteePolityId: PolityId
  originalTaxRateToGrantor: number

  startedWeek: number
  lastContestedWeek?: number

  // enforce 再起案 cooldown 起点 (B6)。
  nextEnforceAllowedWeek?: number
  activeEnforceProjectId?: ProjectId

  accumulatedUnpaidAmount: number
  reasonIds: DecisionReasonId[]

  // terminal になった週。cleanupTerminalObligations の retention 起点。
  terminalWeek?: number
}

// index は active entity のみを保持する (B7)。
export type LandContractDefaultIndex = {
  byHolding: Record<string, LandContractDefaultId[]>
  byContract: Record<string, LandContractDefaultId> // active default は contract 単位で最大 1
  byClaimantPolity: Record<string, LandContractDefaultId[]>
  byOccupierPolity: Record<string, LandContractDefaultId[]>
}
