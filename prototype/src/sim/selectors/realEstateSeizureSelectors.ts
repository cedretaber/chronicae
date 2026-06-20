import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, HouseId, PolityId, RealEstateAssetId } from '../types/ids'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { RealEstateSeizure } from '../types/realEstateSeizure'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import { calcHouseMilitaryPower, calcPolityMilitaryPower } from './militarySelectors'
import { getHouseOwnedPolityIds } from './landContractSelectors'
import { getPolityOverlordPolityIds } from './diplomaticSupportSelectors'

// index は active のみ保持するため、index 経由 getter は active entity のみ返す。

export function getActiveSeizureForAsset(
  state: WorldState,
  assetId: RealEstateAssetId,
): RealEstateSeizure | undefined {
  const id = state.realEstateSeizureIndex.byAsset[assetId as string]
  if (!id) return undefined
  return state.realEstateSeizures[id]
}

export function getActiveSeizuresForHolding(
  state: WorldState,
  holdingId: HoldingId,
): RealEstateSeizure[] {
  const ids = state.realEstateSeizureIndex.byHolding[holdingId as string] ?? []
  const result: RealEstateSeizure[] = []
  for (const id of ids) {
    const s = state.realEstateSeizures[id]
    if (s) result.push(s)
  }
  return result
}

export function getActiveSeizuresForOwnerHouse(
  state: WorldState,
  houseId: HouseId,
): RealEstateSeizure[] {
  const ids = state.realEstateSeizureIndex.byRightfulOwnerHouse[houseId as string] ?? []
  const result: RealEstateSeizure[] = []
  for (const id of ids) {
    const s = state.realEstateSeizures[id]
    if (s) result.push(s)
  }
  return result
}

// 時効までの残り週数。lastContestedWeek 方式 (§13.2)。0 以下なら時効到達。
export function getSeizurePrescriptionRemainingWeeks(
  state: WorldState,
  config: SimulationConfig,
  seizure: RealEstateSeizure,
): number {
  const baseWeek = seizure.lastContestedWeek ?? seizure.startedWeek
  const elapsed = state.absoluteWeek - baseWeek
  return config.realEstateSeizurePrescriptionYears * WEEKS_PER_YEAR - elapsed
}

export function getSeizurePrescriptionRemainingYears(
  state: WorldState,
  config: SimulationConfig,
  seizure: RealEstateSeizure,
): number {
  return Math.max(0, getSeizurePrescriptionRemainingWeeks(state, config, seizure) / WEEKS_PER_YEAR)
}

// owner House の独立抵抗力 (§8.3): 自家戦力 + protector polity 群の戦力 (seizer を除外)。
// seize opportunity / enforce strength gate の両方で使う。
export function computeOwnerHouseResistance(
  state: WorldState,
  config: SimulationConfig,
  ownerHouseId: HouseId,
  seizerPolityId: PolityId,
): number {
  let resistance = calcHouseMilitaryPower(state, config, ownerHouseId)
  // protectorPolityPower: owner House が所有する polity それぞれの overlord 群の military を合計
  //   (seizerPolity 自身は除外)。polity を所有しない House は protector 0。
  const seen = new Set<string>()
  for (const ownedPolityId of getHouseOwnedPolityIds(state, ownerHouseId)) {
    for (const overlordKey of getPolityOverlordPolityIds(state, ownedPolityId)) {
      if (overlordKey === (seizerPolityId as string)) continue
      if (seen.has(overlordKey)) continue
      seen.add(overlordKey)
      resistance += calcPolityMilitaryPower(state, config, overlordKey as PolityId)
    }
  }
  return resistance
}

export type VulnerableAssetPick = {
  asset: RealEstateAsset
  resistance: number
}

// holding 内で最も脆弱な House-owned asset を選ぶ (C1: scoring と Project 作成で共用)。
// Phase 1 制約 (§4.3): owner.kind==='house' / owner House active / owner House != terminal Polity の
// ownerHouse / 同一 asset に active seizure なし。tie-break は resistance 昇順 → asset id 昇順 (決定論)。
export function selectMostVulnerableHouseOwnedAsset(
  state: WorldState,
  config: SimulationConfig,
  seizerPolityId: PolityId,
  holdingId: HoldingId,
): VulnerableAssetPick | undefined {
  const seizerPolity = state.polities[seizerPolityId]
  if (!seizerPolity) return undefined
  const seizerOwnerHouseId = seizerPolity.ownerHouseId
  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  let best: VulnerableAssetPick | undefined
  for (const assetId of [...assetIds].sort()) {
    const asset = state.realEstateAssets[assetId]
    if (!asset) continue
    if (asset.owner?.kind !== 'house') continue
    const ownerHouseId = asset.owner.id
    if (seizerOwnerHouseId && (ownerHouseId as string) === (seizerOwnerHouseId as string)) continue
    const ownerHouse = state.houses[ownerHouseId]
    if (!ownerHouse || !ownerHouse.active) continue
    if (getActiveSeizureForAsset(state, asset.id)) continue
    const resistance = computeOwnerHouseResistance(state, config, ownerHouseId, seizerPolityId)
    if (!best || resistance < best.resistance) {
      best = { asset, resistance }
    }
  }
  return best
}
