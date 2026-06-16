// v0.51 陰謀リファイン: 家の陰謀傾向 (computeConspiracyDrive)。
//
// 旧 ambitionSystem.calcAmbitionScores().plotTendency を移植し、covert HouseGoal
// (pursue_covert_agenda) のスコアとして使う。旧 plotSystem の「全家走査 + plotTendency >=
// plotThreshold + cooldown」ゲートを、goal スコア + cooldown 内蔵で再現する (設計書 §4)。
//
// - RNG 非消費・on-demand (goal スコア評価時に都度計算)。
// - primary polity / house leader 不在は drive 0 (旧 plotTendency と同じ前提)。
// - 閾値 (conspiracyDriveThreshold) 未満 or cooldown 中は 0 を返し covert goal/aim を抑止する。

import type { WorldState } from '../types/world'
import type { HouseId } from '../types/ids'
import type { SimulationConfig } from '../config/defaultConfig'
import { attitudeValueToScore, getAttitudeOrDefault } from '../helpers/attitudeHelpers'
import { getHouseLoyaltyToPolity } from './statusSelectors'
import { getHouseLeader } from './officeSelectors'
import { getHousePrimaryPolityId } from './polityRelations'

// 旧 plotTendency をそのまま移植した raw 値 (ゲート前)。テスト・診断用に分離。
export function computeRawConspiracyDrive(state: WorldState, houseId: HouseId): number {
  const house = state.houses[houseId]
  if (!house || !house.active || house.kind === 'system') return 0

  const primaryPolityId = getHousePrimaryPolityId(state, houseId)
  if (!primaryPolityId) return 0
  const polity = state.polities[primaryPolityId]
  if (!polity) return 0

  const headId = getHouseLeader(state, houseId)
  const head = headId ? state.persons[headId] : undefined
  if (!head || !head.alive) return 0

  const headPolityAtt = getAttitudeOrDefault(state, head, { kind: 'polity', id: primaryPolityId })
  const headPolityLoyalty =
    (attitudeValueToScore(headPolityAtt.affection) * 0.55 +
      attitudeValueToScore(headPolityAtt.respect) * 0.45) /
    100

  const houseLoyalty = getHouseLoyaltyToPolity(state, houseId)

  return (
    head.traits.ambition * 30 +
    house.legacyPrestige * 0.2 +
    (100 - houseLoyalty) * 0.3 +
    (1.0 - headPolityLoyalty) * 20 -
    head.traits.caution * 15 -
    polity.adminPower * 0.1
  )
}

// covert goal/aim 用のゲート済み drive。閾値未満 or cooldown 中は 0。
export function computeConspiracyDrive(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): number {
  const house = state.houses[houseId]
  if (!house || !house.active || house.kind === 'system') return 0

  // cooldown: 直近の陰謀解決から conspiracyCooldownWeeks 経過するまで drive 0 (連発防止)。
  if (
    house.lastConspiracyResolvedWeek !== undefined &&
    state.absoluteWeek < house.lastConspiracyResolvedWeek + config.conspiracyCooldownWeeks
  )
    return 0

  const raw = computeRawConspiracyDrive(state, houseId)
  if (raw < config.conspiracyDriveThreshold) return 0
  return raw
}
