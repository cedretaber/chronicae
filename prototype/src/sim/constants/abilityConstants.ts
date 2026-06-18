import type { AbilityKey } from '../types/person'

export const ABILITY_KEYS = [
  'valor',
  'command',
  'numeracy',
  'learning',
  'charisma',
  'insight',
] as const satisfies readonly AbilityKey[]

export const ABILITY_GENERATION_MAX = 100
export const ABILITY_HARD_CAP = 120

export const ROLE_WEIGHTS = {
  governance: { numeracy: 0.3, learning: 0.3, charisma: 0.2, insight: 0.2 },
  stewardship: { numeracy: 0.6, learning: 0.2, insight: 0.2 },
  diplomacy: { charisma: 0.5, insight: 0.3, learning: 0.2 },
  intrigue: { insight: 0.7, charisma: 0.2, learning: 0.1 },
  strategy: { insight: 0.4, learning: 0.3, command: 0.2, numeracy: 0.1 },
  warCommand: { command: 0.6, insight: 0.2, learning: 0.1, valor: 0.1 },
} as const

export type AgeCurveShape = 'lifelongGrowth' | 'youthPeak' | 'midLifePeak'

export const ABILITY_AGE_CURVES: Record<AbilityKey, AgeCurveShape> = {
  valor: 'youthPeak',
  charisma: 'youthPeak',
  command: 'midLifePeak',
  insight: 'midLifePeak',
  numeracy: 'lifelongGrowth',
  learning: 'lifelongGrowth',
} as const

export const ESTATE_DISPUTE_HEIR_THRESHOLD = 2
