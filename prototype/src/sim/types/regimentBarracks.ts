import type { RegimentBarracksId, HoldingId, RegimentId } from './ids'
import type { PopType } from './popGroup'

export type RegimentBarracksStatus = 'active' | 'inactive'

export type RegimentBarracks = {
  id: RegimentBarracksId
  holdingId: HoldingId
  regimentId: RegimentId

  requiredByPopType: Partial<Record<PopType, number>>

  status: RegimentBarracksStatus

  unpaidCount: number
  lastPayrollFulfillment: number

  createdWeek: number
  inactiveWeek?: number
}

export type RegimentBarracksIndex = {
  byHolding: Record<HoldingId, RegimentBarracksId[]>
  byRegiment: Record<RegimentId, RegimentBarracksId>
}
