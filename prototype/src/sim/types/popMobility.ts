import type { HoldingId, StateRegionId } from './ids'
import type { PopType, PopStratum } from './popGroup'

// v0.56 POP 転職・移住システム (spec-v056-update.md)。

// §2.1 転職・移住の分類。
//   lateral: 同一 PopStratum 内の職種変更。
//   promotion: 下位 stratum から上位 stratum への上方移動。
//   demotion: 上位 stratum から下位 stratum への転落。
export type PopMobilityKind = 'lateral' | 'promotion' | 'demotion'

// §2.2 size を移送する先の merge key。不変条件: class === getPopStratum(popType)。
export type PopTargetKey = {
  holdingId: HoldingId
  class: PopStratum
  popType: PopType
  employed: boolean
}

// §2.3 holding 単位の PopType 雇用需要 (read-model)。
//   idealShareByType: holding 全体で正規化した施設駆動の理想構成比 (Σ_{全 PopType} = 1)。B2 の移住
//     score で使用 (v0.57.1: stratum 内正規化から holding 全体へ。移動の判断を Class 単位に統一)。
//   desiredEmployedByType: 施設駆動の PopType 雇用容量。即時雇用を意味しない推定値。
export type HoldingPopTypeDemand = {
  holdingId: HoldingId
  idealShareByType: Partial<Record<PopType, number>>
  desiredEmployedByType: Partial<Record<PopType, number>>
  currentEmployedByType: Partial<Record<PopType, number>>
  shortageByType: Partial<Record<PopType, number>>
  surplusByType: Partial<Record<PopType, number>>
}

// §2.4 月次 mobility snapshot (UI/分析用 read-model)。WorldState に latest のみ保持。
export type PopMobilitySnapshotEntry = {
  kind: 'job_change' | 'migration'
  amount: number
  sourceHoldingId: HoldingId
  // job_change では source と同一 holding のため省略可。
  targetHoldingId?: HoldingId
  fromPopType: PopType
  toPopType: PopType
  fromEmployed: boolean
  toEmployed: boolean
}

export type MonthlyPopMobilitySnapshot = {
  week: number
  jobChangedTotal: number
  migratedTotal: number
  byState: Record<StateRegionId, { jobChanged: number; migratedIn: number; migratedOut: number }>
  topMovements: PopMobilitySnapshotEntry[]
}
