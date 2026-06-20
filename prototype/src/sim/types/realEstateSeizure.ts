import type {
  RealEstateSeizureId,
  RealEstateAssetId,
  HoldingId,
  PolityId,
  ProjectId,
  DecisionReasonId,
} from './ids'
import type { AssetOwnerRef } from './realEstateAsset'

// v0.53: House-owned RealEstateAsset の owner income を現地 terminal Polity が支払わず、
// Holding 収益へ取り込む状態 (押領)。物理破壊ではなく収益権・所有権の侵害。spec §4。
export type RealEstateSeizureStatus = 'active' | 'resolved' | 'legalized' | 'cancelled'

export type RealEstateSeizure = {
  id: RealEstateSeizureId
  status: RealEstateSeizureStatus

  holdingId: HoldingId
  assetId: RealEstateAssetId

  seizerPolityId: PolityId
  rightfulOwner: AssetOwnerRef // Phase 1 では house のみ

  startedWeek: number
  lastContestedWeek?: number

  // enforce 再起案 cooldown 起点 (B6)。enforce 失敗 / cancel / strength gate 不成立後に
  // absoluteWeek + enforceObligationProjectCooldownWeeks をセット。
  nextEnforceAllowedWeek?: number
  // active enforce_obligation Project (B6: pressureSystem が「active enforce 無し」を判定するため)。
  activeEnforceProjectId?: ProjectId

  accumulatedUnpaidAmount: number
  reasonIds: DecisionReasonId[] // seize_real_estate_income Project の decision reasons を引き継ぐ (B8、空配列許容)

  // terminal (resolved/legalized/cancelled) になった週。cleanupTerminalObligations の retention 起点。
  terminalWeek?: number
}

// index は active entity のみを保持する (B7)。terminal 化時に全 index から除去する。
export type RealEstateSeizureIndex = {
  byHolding: Record<string, RealEstateSeizureId[]>
  byAsset: Record<string, RealEstateSeizureId> // active seizure は asset 単位で最大 1
  byRightfulOwnerHouse: Record<string, RealEstateSeizureId[]>
}

export function isRealEstateSeizureActive(seizure: RealEstateSeizure): boolean {
  return seizure.status === 'active'
}
