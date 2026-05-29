import type { HoldingImprovementId, HoldingId } from './ids'

export type HoldingImprovementKind =
  | 'storage_infrastructure'
  | 'transport_infrastructure'
  | 'field_system'
  | 'pastoral_infrastructure'
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
