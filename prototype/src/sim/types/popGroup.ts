import type { PopGroupId, HoldingId } from './ids'
import type { AttitudeMap } from './attitude'

// v0.55 §13: PopStratum (旧 PopClass の値移行)。PopGroup.class field 名は維持し値のみ移行する。
//   旧 peasants→lower / townsmen→middle / nobles→upper。
export type PopStratum = 'lower' | 'middle' | 'upper'

// v0.55 §13.2: PopType。各 PopType は単一の PopStratum に属する (getPopStratum で導出)。
export type PopType =
  // lower
  | 'laborers'
  | 'peasants'
  | 'artisans'
  | 'scribes'
  | 'soldiers'
  // middle
  | 'freeholders'
  | 'masters'
  | 'merchants'
  | 'bureaucrats'
  | 'ministeriales'
  // upper
  | 'nobles'
  | 'patricians'

// 後方互換 alias (移行期。新規コードは PopStratum を使う)。
export type PopClass = PopStratum

export type PopGroup = {
  id: PopGroupId
  holdingId: HoldingId
  class: PopStratum
  popType: PopType
  employed: boolean
  size: number
  wealth: number
  unrest: number
  attitudes: AttitudeMap
}

export type PopIndex = {
  byHolding: Record<HoldingId, PopGroupId[]>
}

// §13.2: PopStratum ごとの PopType 一覧 (determinism: sorted 反復順)。
export const POP_TYPES_BY_STRATUM: Record<PopStratum, readonly PopType[]> = {
  lower: ['artisans', 'laborers', 'peasants', 'scribes', 'soldiers'],
  middle: ['bureaucrats', 'freeholders', 'masters', 'merchants', 'ministeriales'],
  upper: ['nobles', 'patricians'],
}

export const POP_STRATA: readonly PopStratum[] = ['lower', 'middle', 'upper']

export const POP_TYPES: readonly PopType[] = [
  ...POP_TYPES_BY_STRATUM.lower,
  ...POP_TYPES_BY_STRATUM.middle,
  ...POP_TYPES_BY_STRATUM.upper,
]

const STRATUM_BY_POP_TYPE: Record<PopType, PopStratum> = (() => {
  const m = {} as Record<PopType, PopStratum>
  for (const stratum of POP_STRATA) {
    for (const t of POP_TYPES_BY_STRATUM[stratum]) m[t] = stratum
  }
  return m
})()

// §13.1 不変条件 getPopStratum(pop.popType) === pop.class を導く写像。
export function getPopStratum(popType: PopType): PopStratum {
  return STRATUM_BY_POP_TYPE[popType]
}
