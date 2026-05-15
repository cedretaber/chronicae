export type MapGenerationConfig = {
  linkRemovalEnabled: boolean
  linkRemovalChance: number
  minDegree: number
  maxDeadEnds: number
  targetAverageDegreeMin: number
  targetAverageDegreeMax: number
  jitterEnabled: boolean
  jitterRatioX: number
  jitterRatioY: number
}

export const defaultMapConfig: MapGenerationConfig = {
  linkRemovalEnabled: true,
  linkRemovalChance: 0.28,
  minDegree: 1,
  maxDeadEnds: 6,
  targetAverageDegreeMin: 2.4,
  targetAverageDegreeMax: 2.9,
  jitterEnabled: true,
  jitterRatioX: 0.25,
  jitterRatioY: 0.25,
}
