// v0.44 PersonReputation の selector 群 (spec v0.44 §4.3 / §4.4)。
//
// baseScore は entity に保存し、現在値は月次減衰で都度計算する。
// expiryWeek は作成時に事前計算して保存する (cleanup は週比較のみで済む)。

import type { SimulationConfig } from '@sim/config/defaultConfig'
import type { PersonReputation } from '@sim/types/personReputation'

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
