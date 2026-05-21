export type WorldPresetName = 'tiny' | 'small' | 'standard' | 'perfLarge'

export type WorldPreset = {
  name: WorldPresetName
  stateCount: number
  provinceCountPerStateMin: number
  provinceCountPerStateMax: number
  kingdoms: number
  duchies: number
  counties: number
  holdingsPerProvinceMin: number
  holdingsPerProvinceMax: number
}

export const WORLD_PRESETS: Record<WorldPresetName, WorldPreset> = {
  tiny: {
    name: 'tiny',
    stateCount: 4,
    provinceCountPerStateMin: 3,
    provinceCountPerStateMax: 5,
    kingdoms: 1,
    duchies: 2,
    counties: 6,
    holdingsPerProvinceMin: 2,
    holdingsPerProvinceMax: 2,
  },
  small: {
    name: 'small',
    stateCount: 9,
    provinceCountPerStateMin: 7,
    provinceCountPerStateMax: 11,
    kingdoms: 2,
    duchies: 5,
    counties: 15,
    holdingsPerProvinceMin: 2,
    holdingsPerProvinceMax: 3,
  },
  standard: {
    name: 'standard',
    stateCount: 16,
    provinceCountPerStateMin: 14,
    provinceCountPerStateMax: 18,
    kingdoms: 4,
    duchies: 10,
    counties: 30,
    holdingsPerProvinceMin: 4,
    holdingsPerProvinceMax: 4,
  },
  perfLarge: {
    name: 'perfLarge',
    stateCount: 25,
    provinceCountPerStateMin: 14,
    provinceCountPerStateMax: 18,
    kingdoms: 6,
    duchies: 16,
    counties: 50,
    holdingsPerProvinceMin: 3,
    holdingsPerProvinceMax: 5,
  },
} as const

export const DEFAULT_PRESET: WorldPresetName = 'tiny'
