import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, ProvinceId } from '../types/ids'
import type { RealEstateAsset } from '../types/realEstateAsset'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import { RESOURCE_KINDS } from '../types/resource'
import {
  computeAllocatedLaborByAsset,
  computeAssetRecipePotentials,
} from './resourceProductionSelectors'

// v0.54 §16.6 fallback: snapshot 未生成時に asset の potential net (産出 − 投入、basePrice 評価) の
//   粗 proxy を返す。市場 clearing は再現せず、0 revenue 窓を避けるための純関数 (RNG 非消費)。
//   workshop の原料投入も basePrice で控除するため、snapshot 路 (max(0, netRevenue)) と整合する
//   (gross だけ返すと workshop owner income を inputCost 分過大評価する)。
//   実運用では ResourceEconomySystem が landRevenue/accrual と同 cadence で直前に走るため snapshot は
//   常に最新だが、生成直後の holding や UI 表示のために fallback を用意する。
function estimateAssetPotentialNetRevenue(
  state: WorldState,
  config: SimulationConfig,
  asset: RealEstateAsset,
  allocatedLabor: number,
): number {
  let net = 0
  for (const rp of computeAssetRecipePotentials(state, config, asset, allocatedLabor)) {
    // determinism (§13.1): float 集計順を固定するため RESOURCE_KINDS (sorted) で反復する。
    for (const r of RESOURCE_KINDS) {
      const out = rp.potentialOutputs[r]
      if (out !== undefined) net += out * RESOURCE_PRICE_DEFINITIONS[r].basePrice
      const inp = rp.potentialInputs[r]
      if (inp !== undefined) net -= inp * RESOURCE_PRICE_DEFINITIONS[r].basePrice
    }
  }
  return net
}

function estimateHoldingFallbackRevenue(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  const assets: RealEstateAsset[] = []
  for (const aId of assetIds) {
    const asset = state.realEstateAssets[aId]
    if (asset) assets.push(asset)
  }
  if (assets.length === 0) return 0
  const allocated = computeAllocatedLaborByAsset(state, config, holdingId, assets)
  // snapshot.totalNetRevenue = Σ max(0, asset netRevenue) と整合させ、per-asset で床留めする。
  let total = 0
  for (const asset of assets) {
    total += Math.max(
      0,
      estimateAssetPotentialNetRevenue(state, config, asset, allocated.get(asset.id) ?? 0),
    )
  }
  return total
}

// v0.54 §17.1: holding の月次 revenue (= snapshot.totalNetRevenue = Σ max(0, asset netRevenue))。
//   旧 getHoldingProduction の置換。snapshot 無時は fallback proxy。
export function getHoldingMonthlyResourceRevenue(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const snap = state.monthlyHoldingResourceRevenue[holdingId]
  if (snap) return snap.totalNetRevenue
  return estimateHoldingFallbackRevenue(state, config, holdingId)
}

// v0.54 §17.2: province の月次 revenue (= holding 合計)。旧 getProvinceProduction の置換。
export function getProvinceMonthlyResourceRevenue(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let total = 0
  for (const holdingId of province.holdingIds) {
    total += getHoldingMonthlyResourceRevenue(state, config, holdingId)
  }
  return total
}

// v0.54 §18: asset の月次 owner income (= positiveNet × (1 - holdingDueRate))。
//   snapshot の assetResult を参照。obligation accrual / sale price / house finance が使う。
//   旧 estimateWeeklyOwnerIncome の置換 (週額→月額)。snapshot 無時は fallback。
export function estimateMonthlyOwnerIncome(
  state: WorldState,
  config: SimulationConfig,
  asset: RealEstateAsset,
): number {
  const dueShare = 1 - config.realEstateHoldingDueRate
  const snap = state.monthlyHoldingResourceRevenue[asset.holdingId]
  if (snap) {
    let positiveNet = 0
    for (const ar of snap.assetResults) {
      if ((ar.assetId as string) === (asset.id as string)) {
        positiveNet = Math.max(0, ar.netRevenue)
        break
      }
    }
    return positiveNet * dueShare
  }
  // fallback: asset potential net (産出 − 投入を basePrice 評価) × dueShare の粗 proxy。
  const assetIds = state.realEstateAssetIndex.byHolding[asset.holdingId as string] ?? []
  const assets: RealEstateAsset[] = []
  for (const aId of assetIds) {
    const a = state.realEstateAssets[aId]
    if (a) assets.push(a)
  }
  const allocated = computeAllocatedLaborByAsset(state, config, asset.holdingId, assets)
  const net = Math.max(
    0,
    estimateAssetPotentialNetRevenue(state, config, asset, allocated.get(asset.id) ?? 0),
  )
  return net * dueShare
}
