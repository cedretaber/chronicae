import type { PopGroupId, HoldingId } from './ids'
import type { AttitudeMap } from './attitude'

export type PopClass = 'peasants' | 'townsmen' | 'nobles'

export type PopGroup = {
  id: PopGroupId
  holdingId: HoldingId
  class: PopClass
  employed: boolean
  size: number
  wealth: number
  unrest: number
  attitudes: AttitudeMap
}

export type PopIndex = {
  byHolding: Record<HoldingId, PopGroupId[]>
}
