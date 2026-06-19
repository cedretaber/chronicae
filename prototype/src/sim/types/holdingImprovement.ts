import type { HoldingImprovementId, HoldingId } from './ids'

export type HoldingImprovementKind =
  | 'manor_house'
  | 'town_hall'
  | 'storage_infrastructure'
  | 'transport_infrastructure'
  | 'irrigation_infrastructure'
  | 'market_infrastructure'
  | 'workshop_infrastructure'

export type HoldingImprovement = {
  id: HoldingImprovementId
  holdingId: HoldingId
  kind: HoldingImprovementKind
  level: number
  condition: number
  createdWeek: number
}

// WorldState.holdingImprovementIndex の named 型 (調査 §3.9)。
export type HoldingImprovementIndex = {
  byHolding: Record<string, HoldingImprovementId[]>
}
