import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, ProvinceId } from '../types/ids'
import { getPolityTerminalProvinceIds, getProvinceTerminalPolityId } from './landContractSelectors'
import { calcPolityMilitaryPower } from './militarySelectors'

// v0.18 Stage D §8.4
// acquire_land Intent の候補生成。Polity actor 視点で「狙いたい隣接 Province」を選ぶ。
//
// 判定条件 (spec §8.4):
//   - acquirer Polity active かつ commonwealth ではない
//   - acquirer.treasury >= config.acquireLandMinTreasury
//   - acquirer.lastWarMonth が config.warCooldownMonths 経過済 (cooldown 完了)
//   - target Province は別の active Polity の terminal Province
//   - target Polity active かつ commonwealth ではない (commonwealth は受動防衛のみ)
//   - acquirer terminal Province のいずれかと隣接
//
// priority = (winChance * 100) + provinceDevelopment
//   勝率と開発度の合算で順位付け。実数値は acquireLandMaxIntentsPerActor で上位 N 件のみ採用。
//
// 重複防止 (active Play との) は IntentToDiplomaticPlaySystem の責務。

export type LandAcquireCandidate = {
  acquirerPolityId: PolityId
  targetPolityId: PolityId
  provinceId: ProvinceId
  intentPriority: number
}

export function findLandAcquireIntentCandidates(
  state: WorldState,
  config: SimulationConfig,
): LandAcquireCandidate[] {
  if (!config.acquireLandIntentEnabled) return []

  const results: LandAcquireCandidate[] = []
  const polityIds = Object.keys(state.polities).sort() as PolityId[]
  const currentAbsoluteMonth = state.currentYear * 12 + state.currentMonth

  for (const acquirerPolityId of polityIds) {
    const acquirer = state.polities[acquirerPolityId]
    if (!acquirer || !acquirer.active) continue
    if (acquirer.ownerHouseId === undefined) continue // commonwealth 除外
    if (acquirer.treasury < config.acquireLandMinTreasury) continue

    if (acquirer.lastWarMonth !== undefined) {
      if (currentAbsoluteMonth - acquirer.lastWarMonth < config.warCooldownMonths) {
        continue
      }
    }

    const acquirerProvinceIds = getPolityTerminalProvinceIds(state, acquirerPolityId)
    if (acquirerProvinceIds.length === 0) continue

    const acquirerProvinceSet = new Set<ProvinceId>(acquirerProvinceIds)
    const acquirerPower = calcPolityMilitaryPower(state, config, acquirerPolityId)

    // 候補を順位付けするため一旦 acquirer 視点で集める
    const acquirerCandidates: LandAcquireCandidate[] = []

    // 隣接 Province を走査
    const visitedProvinceIds = new Set<ProvinceId>()
    for (const acquirerProvinceId of acquirerProvinceIds) {
      const acquirerProvince = state.provinces[acquirerProvinceId]
      if (!acquirerProvince) continue

      for (const neighborId of acquirerProvince.neighbors) {
        if (acquirerProvinceSet.has(neighborId)) continue
        if (visitedProvinceIds.has(neighborId)) continue
        visitedProvinceIds.add(neighborId)

        const targetPolityId = getProvinceTerminalPolityId(state, neighborId)
        if (!targetPolityId || targetPolityId === acquirerPolityId) continue

        const target = state.polities[targetPolityId]
        if (!target || !target.active) continue
        if (target.ownerHouseId === undefined) continue // commonwealth target 除外

        const targetProvince = state.provinces[neighborId]
        if (!targetProvince) continue

        const defenderPower = calcPolityMilitaryPower(state, config, targetPolityId)
        const winChance = acquirerPower / (acquirerPower + defenderPower + 1)
        const priority = winChance * 100 + targetProvince.development

        acquirerCandidates.push({
          acquirerPolityId,
          targetPolityId,
          provinceId: neighborId,
          intentPriority: priority,
        })
      }
    }

    if (acquirerCandidates.length === 0) continue

    // priority 降順で上位 N 件のみ採用
    acquirerCandidates.sort((a, b) => b.intentPriority - a.intentPriority)
    const limit = config.acquireLandMaxIntentsPerActor
    for (let i = 0; i < Math.min(limit, acquirerCandidates.length); i++) {
      const candidate = acquirerCandidates[i]
      if (candidate) results.push(candidate)
    }
  }

  return results
}
