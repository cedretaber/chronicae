import type {
  PressureId,
  DiplomaticPlayId,
  ProjectId,
  DecisionReasonId,
  RealEstateSeizureId,
  LandContractDefaultId,
} from './ids'
import type { DecisionSubjectRef } from './goal'

// v0.53: 義務不履行 entity への参照 (Pressure / EnforceObligationProject 共用)。
export type ObligationRef =
  | { kind: 'real_estate_seizure'; id: RealEstateSeizureId }
  | { kind: 'land_contract_default'; id: LandContractDefaultId }

export type PressureKind =
  | 'diplomatic_land_claim'
  | 'diplomatic_contract_revision'
  // v0.53 押領: 権利者 House へ立つ Pressure (enforce_obligation を起案させる)
  | 'real_estate_seizure'
  // v0.53 上納拒否: claimant Polity へ立つ Pressure
  | 'land_contract_default'

export type PressureStatus = 'active' | 'responded' | 'resolved' | 'cancelled'

export type PressureResponseStance = 'resist' | 'negotiate' | 'concede'

export type Pressure = {
  id: PressureId
  kind: PressureKind
  source: DecisionSubjectRef
  target: DecisionSubjectRef
  relatedDiplomaticPlayId?: DiplomaticPlayId
  relatedProjectId?: ProjectId
  // v0.53: real_estate_seizure / land_contract_default Pressure が指す義務 entity
  relatedObligation?: ObligationRef
  responseProjectId?: ProjectId
  priority: number
  createdWeek: number
  deadlineWeek?: number
  status: PressureStatus
  reasonIds: DecisionReasonId[]
}

export type PressureIndex = {
  byTarget: Record<string, PressureId[]>
  bySource: Record<string, PressureId[]>
  byDiplomaticPlay: Record<DiplomaticPlayId, PressureId[]>
  byProject: Record<ProjectId, PressureId[]>
}
