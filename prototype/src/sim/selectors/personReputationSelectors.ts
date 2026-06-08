// v0.44 PersonReputation の selector 群 (spec v0.44 §4.3 / §4.4)。
//
// baseScore は entity に保存し、現在値は月次減衰で都度計算する。
// expiryWeek は作成時に事前計算して保存する (cleanup は週比較のみで済む)。

import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { PersonReputation, ReputationCategory } from '@sim/types/personReputation'
import {
  VALID_REPUTATION_CATEGORIES,
  personReputationOrganizationKey,
} from '@sim/types/personReputation'
import type { WorldState } from '@sim/types/world'
import type { PersonId } from '@sim/types/ids'
import type { OfficeRole, OrganizationRef } from '@sim/types/office'
import { clamp } from '@sim/utils/math'

// 現在値 (§4.3): baseScore * retentionRate^(経過月数)。
export function getCurrentPersonReputationScore(
  reputation: PersonReputation,
  absoluteWeek: number,
  config: SimulationConfig,
): number {
  const elapsedMonths = Math.max(0, Math.floor((absoluteWeek - reputation.createdWeek) / 4))
  return reputation.baseScore * Math.pow(config.personReputationMonthlyRetentionRate, elapsedMonths)
}

// expiryWeek の事前計算 (§4.4)。
// abs(currentScore) < personReputationCleanupThreshold になる週を求める。
// abs(baseScore) <= threshold の場合は reputation を作成しない (undefined を返す)。
// personReputationMonthlyRetentionRate は 0 < rate < 1 を config invariant とする。
export function computeReputationExpiryWeek(
  baseScore: number,
  createdWeek: number,
  config: SimulationConfig,
): number | undefined {
  const threshold = config.personReputationCleanupThreshold
  const rate = config.personReputationMonthlyRetentionRate
  const absBase = Math.abs(baseScore)
  if (absBase <= threshold) return undefined
  const months = Math.ceil(Math.log(threshold / absBase) / Math.log(rate))
  return createdWeek + 4 * months
}

// UI 表示用 (v0.44 追補): 人物の現在評判を category 別に合算したサマリ。
// VALID_REPUTATION_CATEGORIES の定義順・現在値 0 の category は含めない。
// 任用補正と違い clamp しない生の合算値を返す (表示は実態をそのまま見せる)。
export type PersonReputationSummaryEntry = {
  category: ReputationCategory
  score: number
  count: number
}

export function getPersonReputationSummary(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
): PersonReputationSummaryEntry[] {
  const ids = state.personReputationIndex.byPerson[personId]
  if (!ids || ids.length === 0) return []

  const totals = new Map<ReputationCategory, { score: number; count: number }>()
  for (const id of ids) {
    const reputation = state.personReputations[id]
    if (!reputation) continue
    const score = getCurrentPersonReputationScore(reputation, state.absoluteWeek, config)
    const entry = totals.get(reputation.category) ?? { score: 0, count: 0 }
    entry.score += score
    entry.count += 1
    totals.set(reputation.category, entry)
  }

  const result: PersonReputationSummaryEntry[] = []
  for (const category of VALID_REPUTATION_CATEGORIES) {
    const entry = totals.get(category)
    if (!entry || entry.score === 0) continue
    result.push({ category, score: entry.score, count: entry.count })
  }
  return result
}

// ─── 任用・指揮官選定への反映 (§9) ───

// 中核 selector (§9.1): byPerson の現在値を categories filter で等価合算し、
// ±appointmentReputationModifierCap に clamp した raw modifier を返す。
// 注入先係数 (officeReputationScoreFactor / warCommandReputationScoreFactor) は
// 呼び出し側 wrapper で 1 回だけ掛けること (二重適用禁止 §9.3)。
export function getPersonReputationModifierForCategories(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  categories: ReputationCategory[],
): number {
  const ids = state.personReputationIndex.byPerson[personId]
  if (!ids || ids.length === 0) return 0

  let total = 0
  for (const id of ids) {
    const reputation = state.personReputations[id]
    if (!reputation) continue
    if (!categories.includes(reputation.category)) continue
    total += getCurrentPersonReputationScore(reputation, state.absoluteWeek, config)
  }
  return clamp(
    total,
    -config.appointmentReputationModifierCap,
    config.appointmentReputationModifierCap,
  )
}

// 影響力個人中心化 Phase 1a: ある person の、特定 organization (polity/house) に tag された
// 評判の現在値合計を返す (負レコード打ち消し後に 0 床)。House Share 再計算の house-tag 評判項に使う。
// byPerson を走査して relatedOrganization で絞る (person あたり評判は少数なので軽い)。
export function getPersonOrganizationReputationSum(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  org: OrganizationRef,
): number {
  const ids = state.personReputationIndex.byPerson[personId]
  if (!ids || ids.length === 0) return 0
  const orgKey = personReputationOrganizationKey(org)
  let total = 0
  for (const id of ids) {
    const reputation = state.personReputations[id]
    if (!reputation || reputation.relatedOrganization === undefined) continue
    if (personReputationOrganizationKey(reputation.relatedOrganization) !== orgKey) continue
    total += getCurrentPersonReputationScore(reputation, state.absoluteWeek, config)
  }
  return Math.max(0, total)
}

// §9.2: OfficeRole → 参照 category。
export function getReputationCategoriesForOfficeRole(role: OfficeRole): ReputationCategory[] {
  switch (role) {
    case 'administrator':
      return ['administration', 'diplomacy']
    case 'treasurer':
      return ['stewardship', 'administration']
    case 'military':
      return ['military']
    case 'advisor':
      return ['culture', 'diplomacy', 'intrigue']
    case 'leader':
      return ['general', 'diplomacy', 'military', 'administration']
  }
}

// Office 用 wrapper (§9.3): raw modifier × officeReputationScoreFactor。実効 ±5。
export function getAppointmentReputationModifier(
  state: WorldState,
  config: SimulationConfig,
  personId: PersonId,
  role: OfficeRole,
): number {
  return (
    getPersonReputationModifierForCategories(
      state,
      config,
      personId,
      getReputationCategoriesForOfficeRole(role),
    ) * config.officeReputationScoreFactor
  )
}
