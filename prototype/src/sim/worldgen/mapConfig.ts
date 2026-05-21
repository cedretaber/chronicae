export type MapGenerationConfig = {
  worldMapWidth: number
  worldMapHeight: number
  minStateCenterDistance: number
  minProvinceDistance: number
  stateRadiusMin: number
  stateRadiusMax: number
  stateAspectRatioMin: number
  stateAspectRatioMax: number
  intraStateExtraEdgeChance: number
  interStateExtraEdgeChance: number
  maxProvinceDegree: number
  maxInterStateEdgesPerStatePair: number
  mapGenerationMaxAttempts: number
}

export const defaultMapConfig: MapGenerationConfig = {
  worldMapWidth: 1000,
  worldMapHeight: 700,
  minStateCenterDistance: 160,
  minProvinceDistance: 45,
  stateRadiusMin: 80,
  stateRadiusMax: 150,
  stateAspectRatioMin: 0.65,
  stateAspectRatioMax: 1.6,
  intraStateExtraEdgeChance: 0.25,
  interStateExtraEdgeChance: 0.12,
  maxProvinceDegree: 5,
  maxInterStateEdgesPerStatePair: 2,
  mapGenerationMaxAttempts: 200,
}
