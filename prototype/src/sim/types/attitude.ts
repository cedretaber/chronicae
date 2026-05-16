export type Attitude = {
  affection: number // -100..100
  respect: number // -100..100
}

export type AttitudeKey = string

export type AttitudeMap = Record<AttitudeKey, Attitude>
