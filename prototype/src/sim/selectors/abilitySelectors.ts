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
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

export type AppliedRoleKey = 'governance' | 'stewardship' | 'diplomacy' | 'intrigue' | 'warCommand'

// 能力スコアから role 適性スコアを計算する純粋関数。WorldState を必要としない
// (worldgen など state 未組立の文脈から再利用するため切り出し)。
export function getRoleScoreFromAbilities(abilities: AbilityScores, role: AppliedRoleKey): number {
  const weights = ROLE_WEIGHTS[role]
  let score = 0
  for (const [key, weight] of Object.entries(weights) as [AbilityKey, number][]) {
    score += abilities[key] * weight
  }
  return Math.min(score, ABILITY_HARD_CAP)
}

export function getRoleScore(state: WorldState, personId: PersonId, role: AppliedRoleKey): number {
  const person = state.persons[personId]
  if (!person) return 0
  return getRoleScoreFromAbilities(person.abilities, role)
}

// v0.49: 統治者(領主・代官)の「統率＋学識」競争力スコア (0..120)。住民の反乱抑制 (provinceRevolt) と
//   尊敬/軽蔑 (landRevenue の respect) で共通に使う。ROLE_WEIGHTS の定義 role ではない ad-hoc 合成だが、
//   「統率と学識の高い統治者は反感を買いにくく尊敬される」という人物中心史観の単一定義として切り出す。
export function governanceCompetence(abilities: AbilityScores): number {
  return abilities.command * 0.5 + abilities.learning * 0.5
}

// v0.49: 能力中心史観の統一非線形ファクター (spec §10.0)。roleScore(0-120) → 50 中立の乗数。
//   factor = (clamp(score,0,120)/50)^exponent。score50→1.0 (平均不変), 80→2.12, 40→0.70 (exp=1.6)。
//   personAbilityEffectsEnabled OFF 時は 1.0。内政成長/徴税効率/開発コスト/軍 power/adminPower を一括スケール。
export function abilityOutputFactor(roleScore: number, config: SimulationConfig): number {
  if (!config.personAbilityEffectsEnabled) return 1
  const clamped = roleScore < 0 ? 0 : roleScore > 120 ? 120 : roleScore
  return Math.pow(clamped / 50, config.abilityOutputExponent)
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
  // 調査 §1.7: status フィルタを追加。plotSystem は解決済 plot を succeeded/failed の
  // まま activePlots に残す (removePlot は呼ばれない) ため、status を見ないと「一度
  // plot を率いた人物」が永久に insight 経験ありと判定されうる。コメントの意図通り
  // active な plot のみを経験として扱う。
  if (k === 'insight') {
    for (const plot of Object.values(state.activePlots)) {
      if (plot && plot.status === 'active' && plot.leaderId === personId) return true
    }
  }

  // Check if person's primary polity is at war (valor, command experience)
  if (k === 'valor' || k === 'command') {
    const polityId = getPersonPrimaryPolityId(state, personId)
    if (!polityId) return false
    const polity = state.polities[polityId]
    if (polity && polity.lastWarWeek !== undefined) {
      const weeksSinceWar = state.absoluteWeek - polity.lastWarWeek
      if (weeksSinceWar <= WEEKS_PER_YEAR) return true
    }
  }

  return false
}
