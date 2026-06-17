import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingOfficeAssignmentId, HoldingId, PersonId } from '../types/ids'
import type { Person } from '../types/person'
import type { BailiffPolicy } from '../types/landContract'
import type { BailiffRevenueTaskStatus } from '../types/task'
import { clamp } from '../utils/math'
import { isPlaceholderPerson } from './landContractSelectors'

// --- getActiveBailiff ---

// holding に active・非 placeholder・生存の代官 (bailiff) がいれば返す。
// crisisSystem (対処担当者解決) と facilityMaintenanceSystem (定期保守) が共有する。
// provinceOfficeSelectors の getHoldingBailiffPerson は active/placeholder/生存を絞らないため、
// 「実働している代官が居るか」を厳密に問う用途にはこちらを使う。
export function getActiveBailiff(state: WorldState, holdingId: HoldingId): PersonId | undefined {
  const officeId = state.holdingOfficeIndex.byHolding[holdingId]
  if (!officeId) return undefined
  const a = state.holdingOfficeAssignments[officeId]
  if (!a || !a.active) return undefined
  if (isPlaceholderPerson(state, a.holderPersonId)) return undefined
  const holder = state.persons[a.holderPersonId]
  if (!holder || !holder.alive) return undefined
  return a.holderPersonId
}

// --- Policy modifiers (spec §4.4) ---

const BAILIFF_POLICY_EXTRACTION_MODIFIER: Record<BailiffPolicy, number> = {
  passive: 0.0,
  loyal_remittance: 0.03,
  profit_seeking: 0.08,
  protect_residents: -0.05,
}

const BAILIFF_POLICY_FEE_MODIFIER: Record<BailiffPolicy, number> = {
  passive: 0.0,
  loyal_remittance: 0.0,
  profit_seeking: 0.05,
  protect_residents: -0.03,
}

const BAILIFF_POLICY_COLLECTION_MODIFIER: Record<BailiffPolicy, number> = {
  passive: -0.05,
  loyal_remittance: 0.02,
  profit_seeking: 0.05,
  protect_residents: -0.03,
}

const POLICY_TIE_BREAK_ORDER: readonly BailiffPolicy[] = [
  'protect_residents',
  'profit_seeking',
  'loyal_remittance',
  'passive',
]

// --- getBailiffStewardshipScore (spec §7.3) ---

export function getBailiffStewardshipScore(person: Person): number {
  const a = person.abilities
  const t = person.traits
  return a.numeracy * 0.5 + a.learning * 0.2 + a.insight * 0.2 + t.caution * 120 * 0.1
}

// --- getHoldingAverageUnrest (spec §7.4) ---

export function getHoldingAverageUnrest(state: WorldState, holdingId: HoldingId): number {
  const popIds = state.popIndex.byHolding[holdingId]
  if (!popIds || popIds.length === 0) return 0

  let totalSize = 0
  let weightedUnrest = 0
  for (const popId of popIds) {
    const pop = state.popGroups[popId]
    if (!pop) continue
    totalSize += pop.size
    weightedUnrest += pop.unrest * pop.size
  }
  if (totalSize === 0) return 0
  return weightedUnrest / totalSize
}

// --- getBailiffPolicyScores (spec §7.5) ---

export function getBailiffPolicyScores(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): Record<BailiffPolicy, number> {
  const assignment = state.holdingOfficeAssignments[assignmentId]
  if (!assignment) {
    return { passive: 999, loyal_remittance: 0, profit_seeking: 0, protect_residents: 0 }
  }

  const person = state.persons[assignment.holderPersonId]
  if (!person) {
    return { passive: 999, loyal_remittance: 0, profit_seeking: 0, protect_residents: 0 }
  }

  if (person.kind === 'placeholder') {
    return { passive: 999, loyal_remittance: 0, profit_seeking: 0, protect_residents: 0 }
  }

  const a = person.abilities
  const t = person.traits
  const stewardship = getBailiffStewardshipScore(person)
  const localUnrest = getHoldingAverageUnrest(state, assignment.holdingId)

  void config

  const passive = Math.max(0, 70 - stewardship)

  const loyal_remittance = stewardship * 0.6 + a.command * 0.1 + t.caution * 120 * 0.3

  const profit_seeking = t.ambition * 120 * 0.6 + (1 - t.caution) * 120 * 0.2 + a.numeracy * 0.2

  const protect_residents =
    a.charisma * 0.25 + a.insight * 0.3 + t.caution * 120 * 0.2 + localUnrest * 0.25

  return { passive, loyal_remittance, profit_seeking, protect_residents }
}

// --- getBailiffPolicy (spec §7.5) ---

export function getBailiffPolicy(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): BailiffPolicy {
  const scores = getBailiffPolicyScores(state, config, assignmentId)

  let bestPolicy: BailiffPolicy = 'passive'
  let bestScore = -Infinity
  for (const policy of POLICY_TIE_BREAK_ORDER) {
    if (scores[policy] > bestScore) {
      bestScore = scores[policy]
      bestPolicy = policy
    }
  }
  return bestPolicy
}

// --- getBailiffLocalExtractionRate (spec §8.1) ---

export function getBailiffLocalExtractionRate(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): number {
  const assignment = state.holdingOfficeAssignments[assignmentId]
  if (!assignment) return config.minLocalExtractionRate

  const base = assignment.contractedRemittanceRate + assignment.expectedFeeRate
  const policy = getBailiffPolicy(state, config, assignmentId)
  const policyModifier = BAILIFF_POLICY_EXTRACTION_MODIFIER[policy]

  return clamp(base + policyModifier, config.minLocalExtractionRate, config.maxLocalExtractionRate)
}

// --- getBailiffCollectionEfficiency (spec §8.2) ---

export function getBailiffCollectionEfficiency(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
  recentTaskStatus: BailiffRevenueTaskStatus,
): number {
  const assignment = state.holdingOfficeAssignments[assignmentId]
  if (!assignment) return config.minBailiffCollectionEfficiency

  const person = state.persons[assignment.holderPersonId]
  if (!person) return config.minBailiffCollectionEfficiency

  if (person.kind === 'placeholder') {
    return clamp(
      config.placeholderBailiffCollectionEfficiency,
      config.minBailiffCollectionEfficiency,
      1.0,
    )
  }

  const stewardship = getBailiffStewardshipScore(person)
  const a = person.abilities
  const t = person.traits

  // v0.49: stewardship を 60 中立の対称項にし、有能代官と無能代官の徴収額差を ~2x まで開く。
  //   stew78(能力80) → +0.3*range, stew42(能力40) → -0.3*range。
  const stewardshipBand = clamp((stewardship - 60) / 60, -0.5, 1)
  const skillModifier =
    stewardshipBand * config.bailiffStewardshipCollectionRange +
    (a.command / 120) * 0.05 +
    (a.charisma / 120) * 0.05 +
    t.caution * 0.05

  const policy = getBailiffPolicy(state, config, assignmentId)
  const policyModifier = BAILIFF_POLICY_COLLECTION_MODIFIER[policy]

  const taskModifier =
    recentTaskStatus === 'completed'
      ? config.bailiffTaskCompletedCollectionModifier
      : config.bailiffTaskNoneCollectionModifier

  return clamp(
    config.baseBailiffCollectionEfficiency + skillModifier + policyModifier + taskModifier,
    config.minBailiffCollectionEfficiency,
    1.0,
  )
}

// --- getBailiffFeeRate (spec §8.3) ---

export function getBailiffFeeRate(
  state: WorldState,
  config: SimulationConfig,
  assignmentId: HoldingOfficeAssignmentId,
): number {
  const assignment = state.holdingOfficeAssignments[assignmentId]
  if (!assignment) return 0

  const policy = getBailiffPolicy(state, config, assignmentId)
  const policyModifier = BAILIFF_POLICY_FEE_MODIFIER[policy]

  return clamp(assignment.expectedFeeRate + policyModifier, 0, config.maxBailiffFeeRate)
}

// --- computeBailiffBurdenComponents (spec §8.4) ---

export function computeBailiffBurdenComponents(
  localExtractionRate: number,
  collectionEfficiency: number,
  collectionFrictionFactor: number,
): {
  actualExtractionBurdenRate: number
  collectionFrictionBurdenRate: number
  totalBurdenRate: number
} {
  const actualExtractionBurdenRate = localExtractionRate * collectionEfficiency
  const collectionFrictionBurdenRate =
    localExtractionRate * (1 - collectionEfficiency) * collectionFrictionFactor
  return {
    actualExtractionBurdenRate,
    collectionFrictionBurdenRate,
    totalBurdenRate: actualExtractionBurdenRate + collectionFrictionBurdenRate,
  }
}

// --- getRecentBailiffRevenueTaskStatus (spec §14) ---

export function getRecentBailiffRevenueTaskStatus(
  state: WorldState,
  assignmentId: HoldingOfficeAssignmentId,
): BailiffRevenueTaskStatus {
  const assignment = state.holdingOfficeAssignments[assignmentId]
  if (!assignment) return 'none'

  const personId = assignment.holderPersonId
  const logIds = state.personActivityLogIndex.byPerson[personId as string]
  if (!logIds) return 'none'

  const bucket = state.personActivityLogs[personId as string]
  const cutoffWeek = state.absoluteWeek - 4

  for (const logId of logIds) {
    const log = bucket?.[logId]
    if (!log) continue
    if (log.week < cutoffWeek) continue
    if (log.kind !== 'task_completed') continue
    if (log.taskKind !== 'collect_holding_revenue') continue
    if (
      log.sourceRef?.kind === 'holding_office_assignment' &&
      (log.sourceRef.id as string) === (assignmentId as string)
    ) {
      return 'completed'
    }
  }

  return 'none'
}
