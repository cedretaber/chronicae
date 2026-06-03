import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId } from '../types/ids'
import type { PersonGoalKind, Goal } from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'
import { getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import { clamp } from '../utils/math'

export function scorePersonGoalKind(
  state: WorldState,
  _config: SimulationConfig,
  personId: PersonId,
): { kind: PersonGoalKind; score: number }[] {
  const person = state.persons[personId]
  if (!person) return []

  const scores: { kind: PersonGoalKind; score: number }[] = []

  const ambition = person.traits.ambition
  const caution = person.traits.caution

  // Find person's house attitude
  if (!person.houseId) return scores
  const houseAtt = getAttitudeOrDefault(state, person, { kind: 'house', id: person.houseId })

  // Find polity attitude - need to find a polity the person's house belongs to
  // Look through landContracts or shares for associated polity
  let polityAffection = 0
  let polityRespect = 0
  for (const [, share] of Object.entries(state.organizationShares)) {
    if (!share) continue
    if (
      share.holder.kind === 'house' &&
      (share.holder.id as string) === (person.houseId as string)
    ) {
      if (share.organization.kind === 'polity') {
        const att = getAttitudeOrDefault(state, person, {
          kind: 'polity',
          id: share.organization.id,
        })
        polityAffection = att.affection
        polityRespect = att.respect
        break
      }
    }
  }

  // Check if person holds offices
  let hasPolityOffice = false
  let hasHouseOffice = false
  for (const oaId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const oa = state.officeAssignments[oaId]
    if (!oa || !oa.active) continue
    if (oa.organization.kind === 'polity') hasPolityOffice = true
    if (oa.organization.kind === 'house') hasHouseOffice = true
  }

  // Average ability level (0..120 scale)
  const avgAbility =
    (person.abilities.valor +
      person.abilities.command +
      person.abilities.numeracy +
      person.abilities.learning +
      person.abilities.charisma +
      person.abilities.insight) /
    6

  // house_loyalty
  {
    let score = 20
    score += (houseAtt.affection / 100) * 15
    score += (houseAtt.respect / 100) * 10
    if (hasHouseOffice) score += 10
    score += (1 - ambition) * 10
    scores.push({ kind: 'house_loyalty', score: Math.max(1, score) })
  }

  // public_service
  {
    let score = 15
    score += (polityAffection / 100) * 15
    score += (polityRespect / 100) * 10
    if (hasPolityOffice) score += 10
    score +=
      ((person.abilities.learning + person.abilities.insight + person.abilities.charisma) /
        3 /
        120) *
      10
    score += (1 - ambition) * 8
    scores.push({ kind: 'public_service', score: Math.max(1, score) })
  }

  // personal_advancement
  {
    let score = 15
    score += ambition * 20
    score += (avgAbility / 120) * 10
    if (!hasPolityOffice && !hasHouseOffice) score += 8
    score += (1 - person.legacyPrestige / 100) * 5
    scores.push({ kind: 'personal_advancement', score: Math.max(1, score) })
  }

  // wealth_building
  {
    let score = 10
    score += ambition * 10
    score += (person.abilities.numeracy / 120) * 10
    score += Math.max(0, (50 - person.wealth) / 50) * 15
    scores.push({ kind: 'wealth_building', score: Math.max(1, score) })
  }

  // self_cultivation
  {
    let score = 10
    // Higher if young and abilities are below aptitudes
    const abilityGap =
      (person.aptitudes.valor -
        person.abilities.valor +
        person.aptitudes.command -
        person.abilities.command +
        person.aptitudes.numeracy -
        person.abilities.numeracy +
        person.aptitudes.learning -
        person.abilities.learning +
        person.aptitudes.charisma -
        person.abilities.charisma +
        person.aptitudes.insight -
        person.abilities.insight) /
      6
    score += clamp(abilityGap / 120, 0, 1) * 20
    if (person.age < 30) score += 10
    score += caution * 5
    scores.push({ kind: 'self_cultivation', score: Math.max(1, score) })
  }

  return scores
}

export function selectPersonGoalKind(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  rng: RngState,
): { kind: PersonGoalKind; rng: RngState } | undefined {
  const scores = scorePersonGoalKind(state, config, personId)
  if (scores.length === 0) return undefined

  scores.sort((a, b) => b.score - a.score)

  const totalScore = scores.reduce((sum, s) => sum + Math.max(1, s.score), 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let cumulative = 0
  for (const s of scores) {
    cumulative += Math.max(1, s.score) / totalScore
    if (roll < cumulative) {
      return { kind: s.kind, rng: nextRng }
    }
  }
  const first = scores[0]
  if (!first) return undefined
  return { kind: first.kind, rng: nextRng }
}

export function getActivePersonGoal(state: WorldState, personId: PersonId): Goal | undefined {
  const ownerKey = decisionSubjectKey({ kind: 'person', id: personId })
  const goalIds = state.goalIndex.byOwner[ownerKey]
  if (!goalIds) return undefined
  for (const gid of goalIds) {
    const goal = state.goals[gid]
    if (goal && goal.status === 'active') return goal
  }
  return undefined
}

export function getPersonGoalFulfillment(state: WorldState, personId: PersonId): number {
  const goal = getActivePersonGoal(state, personId)
  if (!goal) return 0
  const baseFulfillment = goal.progress

  const person = state.persons[personId]
  if (!person) return baseFulfillment

  let situationalBonus = 0

  // Check offices held
  let hasPolityOffice = false
  let hasHouseOffice = false
  for (const oaId of state.officeIndex.byHolderPerson[personId as string] ?? []) {
    const oa = state.officeAssignments[oaId]
    if (!oa || !oa.active) continue
    if (oa.organization.kind === 'polity') hasPolityOffice = true
    if (oa.organization.kind === 'house') hasHouseOffice = true
  }

  switch (goal.kind) {
    case 'house_loyalty':
      if (hasHouseOffice) situationalBonus += 10
      break
    case 'public_service':
      if (hasPolityOffice) situationalBonus += 10
      break
    case 'personal_advancement':
      if (hasPolityOffice) situationalBonus += 15
      else if (hasHouseOffice) situationalBonus += 8
      situationalBonus += Math.min(10, person.legacyPrestige / 10)
      break
    case 'wealth_building':
      situationalBonus += Math.min(15, person.wealth / 10)
      break
    case 'self_cultivation': {
      const avgAbility =
        (person.abilities.valor +
          person.abilities.command +
          person.abilities.numeracy +
          person.abilities.learning +
          person.abilities.charisma +
          person.abilities.insight) /
        6
      const avgAptitude =
        (person.aptitudes.valor +
          person.aptitudes.command +
          person.aptitudes.numeracy +
          person.aptitudes.learning +
          person.aptitudes.charisma +
          person.aptitudes.insight) /
        6
      if (avgAptitude > 0) {
        situationalBonus += Math.min(15, (avgAbility / avgAptitude) * 15)
      }
      break
    }
    default:
      break
  }

  return clamp(baseFulfillment + situationalBonus, 0, 100)
}
