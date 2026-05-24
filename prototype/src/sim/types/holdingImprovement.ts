import type { HoldingImprovementId, HoldingId } from './ids'

export type HoldingImprovementKind =
  | 'agricultural_infrastructure'
  | 'urban_infrastructure'
  | 'storage_infrastructure'
  | 'transport_infrastructure'

export type HoldingImprovement = {
  id: HoldingImprovementId
  holdingId: HoldingId
  kind: HoldingImprovementKind
  level: number
  condition: number
  createdWeek: number
}
