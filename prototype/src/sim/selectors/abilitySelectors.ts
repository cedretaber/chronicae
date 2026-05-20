import type { WorldState } from '../types/world'
import type { PersonId } from '../types/ids'
import type { AbilityKey, AbilityScores, Person } from '../types/person'
import type { RngState } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import { randomGaussian } from '../rng/rng'
import {
  ABILITY_KEYS,
  ABILITY_GENERATION_MAX,
  ABILITY_HARD_CAP,
  ROLE_WEIGHTS,
  ABILITY_AGE_CURVES,
} from '../constants/abilityConstants'
import type { RngResult } from '../rng/rng'
import { getPersonPrimaryPolityId } from '../selectors/polityRelations'

export type AppliedRoleKey = 'governance' | 'stewardship' | 'diplomacy' | 'intrigue' | 'warCommand'

export function getRoleScore(state: WorldState, personId: PersonId, role: AppliedRoleKey): number {
  const person = state.persons[personId]
  if (!person) return 0
  const weights = ROLE_WEIGHTS[role]
  let score = 0
  for (const [key, weight] of Object.entries(weights) as [AbilityKey, number][]) {
    score += person.abilities[key] * weight
  }
  return Math.min(score, ABILITY_HARD_CAP)
}

export function naturalFraction(k: AbilityKey, age: number, config: SimulationConfig): number {
  const curve = ABILITY_AGE_CURVES[k]
  if (curve === 'lifelongGrowth') {
    return (
      config.ageCurveLifelongMaxFraction * (1 - Math.exp(-age / config.ageCurveLifelongAgeConstant))
    )
  }
  if (curve === 'youthPeak') {
    const peakAge = config.ageCurveYouthPeakAge
    if (age <= peakAge) {
      return config.ageCurveYouthMaxFraction * Math.sqrt(age / peakAge)
    }
    return (
      config.ageCurveYouthMaxFraction *
      Math.exp(-(age - peakAge) / config.ageCurveYouthDeclineConstant)
    )
  }
  // midLifePeak
  const peakAge = config.ageCurveMidLifePeakAge
  if (age <= peakAge) {
    return config.ageCurveMidLifeMaxFraction * Math.sqrt(age / peakAge)
  }
  return (
    config.ageCurveMidLifeMaxFraction *
    Math.exp(-(age - peakAge) / config.ageCurveMidLifeDeclineConstant)
  )
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)))
}

export function sampleAptitudes(rng: RngState, config: SimulationConfig): RngResult<AbilityScores> {
  let currentRng = rng
  const scores: Partial<AbilityScores> = {}
  for (const k of ABILITY_KEYS) {
    const { value, rng: nextRng } = randomGaussian(
      currentRng,
      config.abilityAptitudeMean,
      config.abilityAptitudeStddev,
    )
    scores[k] = clampInt(value, 0, ABILITY_GENERATION_MAX)
    currentRng = nextRng
  }
  return { value: scores as AbilityScores, rng: currentRng }
}

export function inheritAptitudes(
  father: Person,
  mother: Person,
  rng: RngState,
  config: SimulationConfig,
): RngResult<AbilityScores> {
  let currentRng = rng
  const scores: Partial<AbilityScores> = {}
  for (const k of ABILITY_KEYS) {
    const midParent = (father.aptitudes[k] + mother.aptitudes[k]) / 2
    const inherited =
      midParent * config.abilityHeritability +
      config.abilityAptitudeMean * (1 - config.abilityHeritability)
    const { value, rng: nextRng } = randomGaussian(
      currentRng,
      inherited,
      config.abilityAptitudeNoiseStddev,
    )
    scores[k] = clampInt(value, 0, ABILITY_GENERATION_MAX)
    currentRng = nextRng
  }
  return { value: scores as AbilityScores, rng: currentRng }
}

export function sampleAbilitiesFromAptitudes(
  aptitudes: AbilityScores,
  age: number,
  rng: RngState,
  config: SimulationConfig,
): RngResult<AbilityScores> {
  let currentRng = rng
  const scores: Partial<AbilityScores> = {}
  for (const k of ABILITY_KEYS) {
    const fraction = naturalFraction(k, age, config)
    const base = aptitudes[k] * fraction
    const { value, rng: nextRng } = randomGaussian(
      currentRng,
      base,
      config.abilityInitialNoiseStddev,
    )
    scores[k] = clampInt(value, 0, aptitudes[k])
    currentRng = nextRng
  }
  return { value: scores as AbilityScores, rng: currentRng }
}

export function hadRelevantExperience(
  state: WorldState,
  personId: PersonId,
  k: AbilityKey,
): boolean {
  const person = state.persons[personId]
  if (!person || !person.alive) return false

  // Check office assignments for role-based experience
  const officeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const officeId of officeIds) {
    const office = state.officeAssignments[officeId]
    if (!office || !office.active) continue

    const org = office.organization

    if (office.role === 'administrator') {
      // chancellor: numeracy, learning, charisma
      if (k === 'numeracy' || k === 'learning' || k === 'charisma') return true
    }
    if (office.role === 'treasurer') {
      // treasurer: numeracy, learning
      if (k === 'numeracy' || k === 'learning') return true
    }
    if (office.role === 'military') {
      if (org.kind === 'polity') {
        // general: command, learning
        if (k === 'command' || k === 'learning') return true
      } else {
        // marshal: command, valor
        if (k === 'command' || k === 'valor') return true
      }
    }
    if (office.role === 'leader') {
      if (org.kind === 'house') {
        // house leader: command, charisma, insight
        if (k === 'command' || k === 'charisma' || k === 'insight') return true
      } else {
        // polity leader: command, charisma, insight, learning
        if (k === 'command' || k === 'charisma' || k === 'insight' || k === 'learning') return true
      }
    }
  }

  // Check if person leads an active plot (insight experience)
  if (k === 'insight') {
    for (const plot of Object.values(state.activePlots)) {
      if (plot && plot.leaderId === personId) return true
    }
  }

  // Check if person's primary polity is at war (valor, command experience)
  if (k === 'valor' || k === 'command') {
    const polityId = getPersonPrimaryPolityId(state, personId)
    if (!polityId) return false
    const polity = state.polities[polityId]
    if (polity && polity.lastWarWeek !== undefined) {
      const weeksSinceWar = state.absoluteWeek - polity.lastWarWeek
      if (weeksSinceWar <= 52) return true
    }
  }

  return false
}
