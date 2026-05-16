import type { PopGroupId, ProvinceId } from './ids'
import type { AttitudeMap } from './attitude'

export type PopClass = 'peasants' | 'townsmen' | 'nobles'

export type PopGroup = {
  id: PopGroupId
  provinceId: ProvinceId
  class: PopClass
  size: number
  wealth: number
  unrest: number
  attitudes: AttitudeMap
}
