import type { PopGroupId, HoldingId } from './ids'
import type { AttitudeMap } from './attitude'

export type PopClass = 'peasants' | 'townsmen' | 'nobles'

export type PopOccupation = 'agriculture' | 'urban_labor' | 'elite_service' | 'none'

export type PopGroup = {
  id: PopGroupId
  holdingId: HoldingId
  class: PopClass
  occupation: PopOccupation
  size: number
  wealth: number
  unrest: number
  attitudes: AttitudeMap
}

export type PopIndex = {
  byHolding: Record<HoldingId, PopGroupId[]>
}

export function getPrimaryOccupationForClass(popClass: PopClass): PopOccupation {
  switch (popClass) {
    case 'peasants':
      return 'agriculture'
    case 'townsmen':
      return 'urban_labor'
    case 'nobles':
      return 'elite_service'
  }
}
