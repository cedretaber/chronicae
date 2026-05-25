import type { PressureId, DiplomaticPlayId, ProjectId, DecisionReasonId } from './ids'
import type { DecisionSubjectRef } from './goal'

export type PressureKind = 'diplomatic_land_claim' | 'diplomatic_contract_revision'

export type PressureStatus = 'active' | 'responded' | 'resolved' | 'cancelled'

export type PressureResponseStance = 'resist' | 'negotiate' | 'concede'

export type Pressure = {
  id: PressureId
  kind: PressureKind
  source: DecisionSubjectRef
  target: DecisionSubjectRef
  relatedDiplomaticPlayId?: DiplomaticPlayId
  relatedProjectId?: ProjectId
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
