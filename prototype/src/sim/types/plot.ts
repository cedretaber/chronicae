import type { PlotId, PersonId, HouseId, CountryId } from './ids'
import type { RoleType } from './role'

export type PlotType = 'replace_house_head' | 'seize_role' | 'prepare_rebellion'
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
  targetCountryId?: CountryId
  targetRole?: RoleType
  power: number // 0..100
  secrecy: number // 0..100
  risk: number // 0..100
}
