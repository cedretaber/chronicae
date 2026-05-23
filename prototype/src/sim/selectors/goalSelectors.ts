import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HouseId, GoalId } from '../types/ids'
import type {
  DecisionSubjectRef,
  GoalKind,
  PolityGoalKind,
  HouseGoalKind,
  AimKind,
  PolityAimKind,
  HouseAimKind,
  Goal,
  Aim,
  EntityRef,
} from '../types/goal'
import { decisionSubjectKey } from '../types/goal'
import { getPolityTerminalProvinceIds, getProvinceHoldings } from './landContractSelectors'
import { calcPolityMilitaryPower } from './militarySelectors'
import { getHouseOwnedPolityIds } from './landContractSelectors'
import { getHousePolitySharePercent } from './shareSelectors'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'

// --- Lookup helpers ---

export function getActiveGoalForOwner(
  state: WorldState,
  owner: DecisionSubjectRef,
): Goal | undefined {
  const key = decisionSubjectKey(owner)
  const goalIds = state.goalIndex.byOwner[key]
  if (!goalIds) return undefined
  for (const gid of goalIds) {
    const goal = state.goals[gid]
    if (goal && goal.status === 'active') return goal
  }
  return undefined
}

export function getActiveAimsForGoal(state: WorldState, goalId: GoalId): Aim[] {
  const aimIds = state.aimIndex.byGoal[goalId as string]
  if (!aimIds) return []
  const result: Aim[] = []
  for (const aid of aimIds) {
    const aim = state.aims[aid]
    if (aim && aim.status === 'active') result.push(aim)
  }
  return result
}

export function getActiveAimForOwner(
  state: WorldState,
  owner: DecisionSubjectRef,
): Aim | undefined {
  const key = decisionSubjectKey(owner)
  const aimIds = state.aimIndex.byOwner[key]
  if (!aimIds) return undefined
  for (const aid of aimIds) {
    const aim = state.aims[aid]
    if (aim && aim.status === 'active') return aim
  }
  return undefined
}

// --- Polity Goal scoring ---

export function scorePolityGoalKind(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
): { kind: PolityGoalKind; score: number }[] {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) return []

  const terminalProvinceIds = getPolityTerminalProvinceIds(state, polityId)
  const ownPower = calcPolityMilitaryPower(state, config, polityId)

  // external_expansion scoring
  let expansionScore = 0
  let hasAcquirableNeighbor = false

  for (const pid of terminalProvinceIds) {
    const province = state.provinces[pid]
    if (!province) continue
    for (const neighborId of province.neighbors) {
      const neighborProvince = state.provinces[neighborId]
      if (!neighborProvince) continue
      // Check if any holding in this neighbor province is held by a different polity
      const holdings = getProvinceHoldings(state, neighborId)
      for (const h of holdings) {
        const terminalPolity = state.holdingTerminalPolityCache[h.id]
        if (terminalPolity && (terminalPolity as string) !== (polityId as string)) {
          hasAcquirableNeighbor = true
          const targetPower = calcPolityMilitaryPower(state, config, terminalPolity)
          if (ownPower > targetPower * 1.1) {
            expansionScore += 15
          }
        }
      }
    }
  }
  if (hasAcquirableNeighbor) expansionScore += 20
  if (polity.treasury > 200) expansionScore += 10

  // internal_development scoring
  let developmentScore = 0
  for (const pid of terminalProvinceIds) {
    const holdings = getProvinceHoldings(state, pid)
    for (const h of holdings) {
      if (h.development < 30) developmentScore += 10
    }
  }
  if (polity.treasury > 100) developmentScore += 10
  // If no acquirable neighbors, development is more attractive
  if (!hasAcquirableNeighbor) developmentScore += 20

  return [
    { kind: 'external_expansion', score: expansionScore },
    { kind: 'internal_development', score: developmentScore },
  ]
}

// --- House Goal scoring ---

export function scoreHouseGoalKind(
  state: WorldState,
  _config: SimulationConfig,
  houseId: HouseId,
): { kind: HouseGoalKind; score: number }[] {
  const house = state.houses[houseId]
  if (!house || !house.active || house.kind === 'system') return []

  const ownedPolityIds = getHouseOwnedPolityIds(state, houseId)

  // expand_power_base
  let expandScore = 0
  if (ownedPolityIds.length > 0) expandScore += 15
  for (const pid of ownedPolityIds) {
    const sharePercent = getHousePolitySharePercent(state, pid, houseId)
    if (sharePercent < 50) expandScore += 10
  }
  if (house.wealth >= 100) expandScore += 10

  // preserve_power_base
  let preserveScore = 0
  for (const pid of ownedPolityIds) {
    const sharePercent = getHousePolitySharePercent(state, pid, houseId)
    if (sharePercent >= 50) preserveScore += 15
  }
  if (ownedPolityIds.length === 0) preserveScore += 5

  // cultivate_prestige
  let prestigeScore = 0
  if (house.wealth >= 80) prestigeScore += 15
  if (house.legacyPrestige < 30) prestigeScore += 10
  if (ownedPolityIds.length === 0) prestigeScore += 5

  return [
    { kind: 'expand_power_base', score: expandScore },
    { kind: 'preserve_power_base', score: preserveScore },
    { kind: 'cultivate_prestige', score: prestigeScore },
  ]
}

// --- Aim selection ---

// For a given Goal, pick an AimKind and target.
export function pickAimForGoal(
  state: WorldState,
  config: SimulationConfig,
  goal: Goal,
  rng: RngState,
): { kind: AimKind; target?: EntityRef; rng: RngState } | undefined {
  if (goal.owner.kind === 'polity') {
    return pickPolityAim(
      state,
      config,
      goal.owner.id,
      goal.kind as PolityGoalKind,
      rng,
      state.absoluteWeek,
    )
  }
  if (goal.owner.kind === 'house') {
    return pickHouseAim(state, config, goal.owner.id, goal.kind as HouseGoalKind, rng)
  }
  return undefined
}

function pickPolityAim(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  goalKind: PolityGoalKind,
  rng: RngState,
  absoluteWeek: number,
): { kind: PolityAimKind; target?: EntityRef; rng: RngState } | undefined {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) return undefined

  const candidates: { kind: PolityAimKind; target?: EntityRef; score: number }[] = []

  if (goalKind === 'external_expansion') {
    // consolidate_province_holdings: find provinces where we have some holdings but not all
    const terminalProvinceIds = getPolityTerminalProvinceIds(state, polityId)
    for (const pid of terminalProvinceIds) {
      const province = state.provinces[pid]
      if (!province) continue
      for (const neighborId of province.neighbors) {
        const nProvince = state.provinces[neighborId]
        if (!nProvince) continue
        const holdings = getProvinceHoldings(state, neighborId)
        let ownCount = 0
        let otherCount = 0
        for (const h of holdings) {
          const tp = state.holdingTerminalPolityCache[h.id]
          if (tp && (tp as string) === (polityId as string)) ownCount++
          else otherCount++
        }
        if (ownCount > 0 && otherCount > 0) {
          candidates.push({
            kind: 'consolidate_province_holdings',
            target: { kind: 'province', id: neighborId },
            score: 30 + ownCount * 10,
          })
        }
      }
    }

    // seize_weak_remote_holdings: find weak polity holdings
    const ownPower = calcPolityMilitaryPower(state, config, polityId)
    for (const pid of terminalProvinceIds) {
      const province = state.provinces[pid]
      if (!province) continue
      for (const neighborId of province.neighbors) {
        const holdings = getProvinceHoldings(state, neighborId)
        for (const h of holdings) {
          const tp = state.holdingTerminalPolityCache[h.id]
          if (!tp || (tp as string) === (polityId as string)) continue
          const targetPower = calcPolityMilitaryPower(state, config, tp)
          if (ownPower > targetPower * 1.25) {
            candidates.push({
              kind: 'seize_weak_remote_holdings',
              target: { kind: 'province', id: neighborId },
              score: 20 + (ownPower - targetPower * 1.25) * 0.1,
            })
          }
        }
      }
    }
  }

  // tax revision aims: available under both external_expansion and internal_development
  const contractIds = state.landContractIndex.byGranteePolity[polityId] ?? []
  for (const cid of contractIds) {
    const contract = state.landContracts[cid]
    if (!contract) continue
    if (contract.termsProtectedUntilWeek && absoluteWeek < contract.termsProtectedUntilWeek)
      continue
    if (contract.terms.taxRateToGrantor > 0.2) {
      candidates.push({
        kind: 'improve_owned_contract_terms',
        target: contract.holdingId
          ? { kind: 'holding', id: contract.holdingId }
          : { kind: 'province', id: contract.provinceId },
        score: 15 + contract.terms.taxRateToGrantor * 50,
      })
    }
  }
  for (const cid of contractIds) {
    const contract = state.landContracts[cid]
    if (!contract) continue
    const childContractId = state.landContractIndex.byParent[contract.id]
    if (childContractId === undefined) continue
    const child = state.landContracts[childContractId]
    if (!child) continue
    if (child.termsProtectedUntilWeek && absoluteWeek < child.termsProtectedUntilWeek) continue
    if (child.terms.taxRateToGrantor >= config.taxRevisionMaxRateForIncrease) continue
    const vassalPolity = state.polities[child.granteePolityId]
    if (!vassalPolity || !vassalPolity.active) continue
    candidates.push({
      kind: 'demand_tax_increase_from_vassal',
      target: child.holdingId
        ? { kind: 'holding', id: child.holdingId }
        : { kind: 'province', id: child.provinceId },
      score: 15 + (config.taxRevisionMaxRateForIncrease - child.terms.taxRateToGrantor) * 50,
    })
  }

  if (goalKind !== 'external_expansion') {
    // internal_development
    // develop_owned_holding
    const terminalProvinceIds = getPolityTerminalProvinceIds(state, polityId)
    for (const pid of terminalProvinceIds) {
      const holdings = getProvinceHoldings(state, pid)
      for (const h of holdings) {
        const tp = state.holdingTerminalPolityCache[h.id]
        if (!tp || (tp as string) !== (polityId as string)) continue
        if (h.development < 50) {
          candidates.push({
            kind: 'develop_owned_holding',
            target: { kind: 'holding', id: h.id },
            score: 20 + (50 - h.development) * 0.5 + h.landQuality * 0.3,
          })
        }
      }
    }
  }

  if (candidates.length === 0) return undefined

  // Sort by score descending, pick top with some randomness
  candidates.sort((a, b) => b.score - a.score)
  // Pick from top 3 with weighted random
  const topN = candidates.slice(0, 3)
  const totalScore = topN.reduce((sum, c) => sum + Math.max(1, c.score), 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let cumulative = 0
  for (const c of topN) {
    cumulative += Math.max(1, c.score) / totalScore
    if (roll < cumulative) {
      return { kind: c.kind, ...(c.target !== undefined ? { target: c.target } : {}), rng: nextRng }
    }
  }
  // Fallback to first
  const first = topN[0]!
  return {
    kind: first.kind,
    ...(first.target !== undefined ? { target: first.target } : {}),
    rng: nextRng,
  }
}

function pickHouseAim(
  state: WorldState,
  _config: SimulationConfig,
  houseId: HouseId,
  goalKind: HouseGoalKind,
  rng: RngState,
): { kind: HouseAimKind; target?: EntityRef; rng: RngState } | undefined {
  const house = state.houses[houseId]
  if (!house || !house.active) return undefined

  const ownedPolityIds = getHouseOwnedPolityIds(state, houseId)

  const candidates: { kind: HouseAimKind; target?: EntityRef; score: number }[] = []

  if (goalKind === 'expand_power_base') {
    // increase_polity_share
    for (const pid of ownedPolityIds) {
      const sharePercent = getHousePolitySharePercent(state, pid, houseId)
      if (sharePercent < 70) {
        candidates.push({
          kind: 'increase_polity_share',
          target: { kind: 'polity', id: pid },
          score: 25 + (70 - sharePercent) * 0.5,
        })
      }
    }
    // steer_polity_external_expansion
    for (const pid of ownedPolityIds) {
      const sharePercent = getHousePolitySharePercent(state, pid, houseId)
      if (sharePercent >= 20) {
        candidates.push({
          kind: 'steer_polity_external_expansion',
          target: { kind: 'polity', id: pid },
          score: 15 + sharePercent * 0.3,
        })
      }
    }
  } else if (goalKind === 'preserve_power_base') {
    // steer_polity_internal_development
    for (const pid of ownedPolityIds) {
      const sharePercent = getHousePolitySharePercent(state, pid, houseId)
      if (sharePercent >= 20) {
        candidates.push({
          kind: 'steer_polity_internal_development',
          target: { kind: 'polity', id: pid },
          score: 20 + sharePercent * 0.3,
        })
      }
    }
    // increase_polity_share (also valid for preserve)
    for (const pid of ownedPolityIds) {
      const sharePercent = getHousePolitySharePercent(state, pid, houseId)
      if (sharePercent < 50) {
        candidates.push({
          kind: 'increase_polity_share',
          target: { kind: 'polity', id: pid },
          score: 15 + (50 - sharePercent) * 0.3,
        })
      }
    }
  } else {
    // cultivate_prestige
    if (house.wealth >= 25) {
      candidates.push({ kind: 'patronize_artist', score: 20 })
    }
    if (house.wealth >= 40) {
      candidates.push({ kind: 'commission_chronicle', score: 25 })
    }
  }

  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => b.score - a.score)
  const topN = candidates.slice(0, 3)
  const totalScore = topN.reduce((sum, c) => sum + Math.max(1, c.score), 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let cumulative = 0
  for (const c of topN) {
    cumulative += Math.max(1, c.score) / totalScore
    if (roll < cumulative) {
      return { kind: c.kind, ...(c.target !== undefined ? { target: c.target } : {}), rng: nextRng }
    }
  }
  const first = topN[0]!
  return {
    kind: first.kind,
    ...(first.target !== undefined ? { target: first.target } : {}),
    rng: nextRng,
  }
}

// --- Goal selection (pick the best GoalKind for an owner) ---

export function selectGoalKind(
  state: WorldState,
  config: SimulationConfig,
  owner: DecisionSubjectRef,
  rng: RngState,
): { kind: GoalKind; rng: RngState } | undefined {
  let scores: { kind: GoalKind; score: number }[] = []

  if (owner.kind === 'polity') {
    scores = scorePolityGoalKind(state, config, owner.id)
  } else if (owner.kind === 'house') {
    scores = scoreHouseGoalKind(state, config, owner.id)
  }

  if (scores.length === 0) return undefined

  // Apply House steer_polity_* influence bonus if owner is a polity
  if (owner.kind === 'polity') {
    scores = applyPolicyInfluenceBonus(state, config, owner.id, scores)
  }

  scores.sort((a, b) => b.score - a.score)

  // Weighted random from top candidates
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

// Apply policyInfluenceBonus from active House steer_polity_* Aims (§16.2)
function applyPolicyInfluenceBonus(
  state: WorldState,
  config: SimulationConfig,
  polityId: PolityId,
  scores: { kind: GoalKind; score: number }[],
): { kind: GoalKind; score: number }[] {
  const result = scores.map((s) => ({ ...s }))

  // Scan all active Aims owned by houses
  for (const [, aim] of Object.entries(state.aims)) {
    if (!aim || aim.status !== 'active') continue
    if (aim.owner.kind !== 'house') continue
    // Check if Aim targets this polity
    if (!aim.target || aim.target.kind !== 'polity') continue
    if ((aim.target.id as string) !== (polityId as string)) continue

    const houseId = aim.owner.id
    const sharePercent = getHousePolitySharePercent(state, polityId, houseId)

    const bonus =
      config.policyInfluenceBonusBase + sharePercent * config.policyInfluenceBonusShareFactor

    if (aim.kind === 'steer_polity_external_expansion') {
      const entry = result.find((s) => s.kind === 'external_expansion')
      if (entry) entry.score += bonus
    } else if (aim.kind === 'steer_polity_internal_development') {
      const entry = result.find((s) => s.kind === 'internal_development')
      if (entry) entry.score += bonus
    }
  }

  return result
}
