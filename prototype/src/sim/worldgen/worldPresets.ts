export type WorldPresetName = 'tiny' | 'small' | 'standard' | 'perfLarge'

export type WorldPreset = {
  name: WorldPresetName
  gridCols: number
  gridRows: number
  stateCols: number
  stateRows: number
  provBlockCols: number
  provBlockRows: number
  kingdoms: number
  duchies: number
  counties: number
}

export const WORLD_PRESETS: Record<WorldPresetName, WorldPreset> = {
  tiny: {
    name: 'tiny',
    gridCols: 4,
    gridRows: 4,
    stateCols: 2,
    stateRows: 2,
    provBlockCols: 2,
    provBlockRows: 2,
    kingdoms: 1,
    duchies: 2,
    counties: 6,
  },
  small: {
    name: 'small',
    gridCols: 9,
    gridRows: 9,
    stateCols: 3,
    stateRows: 3,
    provBlockCols: 3,
    provBlockRows: 3,
    kingdoms: 2,
    duchies: 5,
    counties: 15,
  },
  standard: {
    name: 'standard',
    gridCols: 16,
    gridRows: 16,
    stateCols: 4,
    stateRows: 4,
    provBlockCols: 4,
    provBlockRows: 4,
    kingdoms: 4,
    duchies: 10,
    counties: 30,
  },
  perfLarge: {
    name: 'perfLarge',
    gridCols: 20,
    gridRows: 20,
    stateCols: 5,
    stateRows: 5,
    provBlockCols: 4,
    provBlockRows: 4,
    kingdoms: 6,
    duchies: 16,
    counties: 50,
  },
} as const

export const DEFAULT_PRESET: WorldPresetName = 'tiny'
