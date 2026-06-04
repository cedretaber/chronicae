import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, HouseId, GoalId, ProvinceId, LandContractId } from '../types/ids'
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
import {
  getPolityTerminalProvinceIds,
  getProvinceHoldings,
  getLandContractGrantor,
} from './landContractSelectors'
import { getHoldingDevelopment } from './holdingImprovementSelectors'
import { calcPolityMilitaryPower } from './militarySelectors'
import { getHouseOwnedPolityIds } from './landContractSelectors'
import { predictPressureResponseStance } from './pressureStanceSelectors'
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

// --- Aim slot key (v0.43) ---
// 1 Goal が複数 active Aim を持つとき、「同じ対象に同じ種類の Aim を二重に持たない」ための
// スロット識別キー。生成側 (pickAimForGoal の候補除外) と integrity の重複検査が *同一* の
// キーを共有しなければならない (ズレると「生成した直後に integrity が弾く」状態になる)。
function entityRefKey(ref: EntityRef): string {
  if (ref.kind === 'office') {
    return `office:${ref.organization.kind}:${ref.organization.id}:${ref.role}`
  }
  if (ref.kind === 'ability') {
    return `ability:${ref.ability}`
  }
  return `${ref.kind}:${ref.id}`
}

export function aimSlotKey(kind: AimKind, target?: EntityRef): string {
  return target ? `${kind}|${entityRefKey(target)}` : kind
}

// --- Aim capacity (v0.43) ---
// 1 Goal が同時に持てる active Aim 数を、owner (国・家) の規模/予算に連動させて算出する。
// 小国は base のみ、大国・富裕な家ほど枠が増え、静的 ceiling でクランプされる。
// これは「生成側スロットル (動的 cap)」であり integrity の invariant ではない
// (国が縮小して capacity が下がっても、既に作った Aim は ceiling 以下なら合法のまま)。
export function computeAimCapacityForGoal(
  state: WorldState,
  config: SimulationConfig,
  owner: DecisionSubjectRef,
): number {
  let extra = 0
  if (owner.kind === 'polity') {
    const polity = state.polities[owner.id]
    if (polity) {
      const provinceCount = getPolityTerminalProvinceIds(state, owner.id).length
      extra += Math.floor(provinceCount / config.aimCapacityProvincesPerSlot)
      extra += Math.floor(Math.max(0, polity.treasury) / config.aimCapacityTreasuryPerSlot)
    }
  } else if (owner.kind === 'house') {
    const house = state.houses[owner.id]
    if (house) {
      extra += Math.floor(house.memberIds.length / config.aimCapacityMembersPerSlot)
      extra += Math.floor(Math.max(0, house.wealth) / config.aimCapacityWealthPerSlot)
    }
  }
  const capacity = config.aimCapacityBase + extra
  return Math.max(1, Math.min(config.aimParallelismCeiling, capacity))
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
      if (
        getHoldingDevelopment(state, config, h.id) < config.developHoldingTargetDevelopmentThreshold
      )
        developmentScore += 10
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
// excludedSlots: 既に同 owner で active な Aim の aimSlotKey 集合。候補から除外して
// 「同じ対象の二重 Aim」を防ぐ (v0.43 Aim 並列化)。空集合なら従来挙動と同一。
export function pickAimForGoal(
  state: WorldState,
  config: SimulationConfig,
  goal: Goal,
  rng: RngState,
  excludedSlots: Set<string> = new Set(),
): { kind: AimKind; target?: EntityRef; rng: RngState } | undefined {
  if (goal.owner.kind === 'polity') {
    return pickPolityAim(
      state,
      config,
      goal.owner.id,
      goal.kind as PolityGoalKind,
      rng,
      state.absoluteWeek,
      excludedSlots,
    )
  }
  if (goal.owner.kind === 'house') {
    return pickHouseAim(
      state,
      config,
      goal.owner.id,
      goal.kind as HouseGoalKind,
      rng,
      excludedSlots,
    )
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
  excludedSlots: Set<string>,
): { kind: PolityAimKind; target?: EntityRef; rng: RngState } | undefined {
  const polity = state.polities[polityId]
  if (!polity || !polity.active) return undefined

  const candidates: { kind: PolityAimKind; target?: EntityRef; score: number }[] = []

  if (goalKind === 'external_expansion') {
    const terminalProvinceIds = getPolityTerminalProvinceIds(state, polityId)

    // consolidate_province_holdings: find provinces where we have some holdings but not all
    const checkedForConsolidate = new Set<ProvinceId>()
    for (const pid of terminalProvinceIds) {
      if (checkedForConsolidate.has(pid)) continue
      checkedForConsolidate.add(pid)
      const holdings = getProvinceHoldings(state, pid)
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
          target: { kind: 'province', id: pid },
          score: 30 + ownCount * 10,
        })
      }
    }

    // seize_weak_remote_holdings: find weak polity holdings in neighboring provinces
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

  // 開始ゲート: 減税系 aim (vassal → grantor) は、grantor (宗主) が resist 確実なら
  // 起こしても status_quo に終わるだけ。行動を起こす前に弾き、actor が無謀な減税要求を
  // 量産して「外交劇は起こすが何も変わらない」を連発するのを防ぐ。
  // 受諾見込みの予測は play 開始ゲート (diplomaticPlayCreation) / defender の実 stance 決定と
  // 同一式 (predictPressureResponseStance) を共有する。
  const grantorWouldResist = (cid: LandContractId): boolean => {
    const grantor = getLandContractGrantor(state, cid)
    if (!grantor || grantor.kind !== 'polity') return false
    return (
      predictPressureResponseStance(
        state,
        config,
        { kind: 'polity', id: polityId },
        { kind: 'polity', id: grantor.id },
      ) === 'resist'
    )
  }

  for (const cid of contractIds) {
    const contract = state.landContracts[cid]
    if (!contract) continue
    if (contract.termsProtectedUntilWeek && absoluteWeek < contract.termsProtectedUntilWeek)
      continue
    if (grantorWouldResist(contract.id)) continue
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
  // eliminate_overlord_contract: tax rate already at/near minimum → push for contract removal
  for (const cid of contractIds) {
    const contract = state.landContracts[cid]
    if (!contract || contract.rootAuthorityId) continue
    if (contract.termsProtectedUntilWeek && absoluteWeek < contract.termsProtectedUntilWeek)
      continue
    if (grantorWouldResist(contract.id)) continue
    if (contract.terms.taxRateToGrantor <= config.taxRevisionMinRateForReduction) {
      candidates.push({
        kind: 'eliminate_overlord_contract',
        target: contract.holdingId
          ? { kind: 'holding', id: contract.holdingId }
          : { kind: 'province', id: contract.provinceId },
        score: 40 + (config.taxRevisionMinRateForReduction - contract.terms.taxRateToGrantor) * 200,
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
    const vassalPolity = state.polities[child.granteePolityId]
    if (!vassalPolity || !vassalPolity.active) continue
    if (child.terms.taxRateToGrantor >= config.taxRevisionMaxRateForIncrease) {
      // eliminate_vassal_contract: tax rate already at/near maximum → push for contract removal
      candidates.push({
        kind: 'eliminate_vassal_contract',
        target: child.holdingId
          ? { kind: 'holding', id: child.holdingId }
          : { kind: 'province', id: child.provinceId },
        score: 40 + (child.terms.taxRateToGrantor - config.taxRevisionMaxRateForIncrease) * 200,
      })
    } else {
      candidates.push({
        kind: 'demand_tax_increase_from_vassal',
        target: child.holdingId
          ? { kind: 'holding', id: child.holdingId }
          : { kind: 'province', id: child.provinceId },
        score: 15 + (config.taxRevisionMaxRateForIncrease - child.terms.taxRateToGrantor) * 50,
      })
    }
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
        const holdingDev = getHoldingDevelopment(state, config, h.id)
        if (holdingDev < config.developHoldingTargetDevelopmentThreshold) {
          candidates.push({
            kind: 'develop_owned_holding',
            target: { kind: 'holding', id: h.id },
            score:
              20 +
              (config.developHoldingTargetDevelopmentThreshold - holdingDev) * 0.5 +
              h.landQuality * 0.3,
          })
        }
      }
    }
  }

  // 既に同 owner で active な Aim が占めるスロットを除外 (v0.43)
  const available =
    excludedSlots.size === 0
      ? candidates
      : candidates.filter((c) => !excludedSlots.has(aimSlotKey(c.kind, c.target)))
  if (available.length === 0) return undefined

  // Sort by score descending, pick top with some randomness
  available.sort((a, b) => b.score - a.score)
  // Pick from top 3 with weighted random
  const topN = available.slice(0, 3)
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
  excludedSlots: Set<string>,
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

  // 既に同 owner で active な Aim が占めるスロットを除外 (v0.43)
  const available =
    excludedSlots.size === 0
      ? candidates
      : candidates.filter((c) => !excludedSlots.has(aimSlotKey(c.kind, c.target)))
  if (available.length === 0) return undefined

  available.sort((a, b) => b.score - a.score)
  const topN = available.slice(0, 3)
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
