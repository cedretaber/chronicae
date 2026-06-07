// v0.44 PersonReputation の selector 群 (spec v0.44 §4.3 / §4.4)。
//
// baseScore は entity に保存し、現在値は月次減衰で都度計算する。
// expiryWeek は作成時に事前計算して保存する (cleanup は週比較のみで済む)。

import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { PersonReputation, ReputationCategory } from '@sim/types/personReputation'
import type { WorldState } from '@sim/types/world'
import type { PersonId } from '@sim/types/ids'
import type { OfficeRole } from '@sim/types/office'
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
