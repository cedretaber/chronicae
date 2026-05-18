import type { PlotId, PersonId, HouseId, PolityId } from './ids'
import type { OfficeRole } from './office'

export type PlotType = 'replace_house_leader' | 'seize_office' | 'prepare_rebellion'
export type PlotStatus = 'active' | 'succeeded' | 'failed' | 'cancelled'

export type Plot = {
  id: PlotId
  type: PlotType
  status: PlotStatus
  startedYear: number
  startedMonth: number
  durationMonths: number
  elapsedMonths: number
  leaderId: PersonId
  participantIds: PersonId[]
  targetPersonId?: PersonId
  targetHouseId?: HouseId
  targetPolityId?: PolityId
  targetRole?: OfficeRole
  power: number // 0..100
  secrecy: number // 0..100
  risk: number // 0..100
}
