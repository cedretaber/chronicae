import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId } from '../types/ids'
import type { RealEstateAsset } from '../types/realEstateAsset'
import { getHoldingProduction } from './popEconomySelectors'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

export function estimateRealEstateAssetWeight(
  asset: RealEstateAsset,
  config: SimulationConfig,
): number {
  const kindWeight = config.realEstateKindIncomeWeight[asset.realEstateKind] ?? 1.0
  return asset.level * kindWeight
}

export function getHoldingTotalRealEstateWeight(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  let total = 0
  for (const aId of assetIds) {
    const asset = state.realEstateAssets[aId]
    if (asset) total += estimateRealEstateAssetWeight(asset, config)
  }
  return total
}

export function estimateWeeklyOwnerIncome(
  state: WorldState,
  config: SimulationConfig,
  asset: RealEstateAsset,
): number {
  const totalWeight = getHoldingTotalRealEstateWeight(state, config, asset.holdingId)
  if (totalWeight <= 0) return 0
  const assetWeight = estimateRealEstateAssetWeight(asset, config)
  const grossRevenue = getHoldingProduction(state, config, asset.holdingId)
  return grossRevenue * config.realEstateOwnerIncomeRate * (assetWeight / totalWeight)
}

export type OwnerIncomeEntry = {
  owner: import('../types/realEstateAsset').AssetOwnerRef
  income: number
}

export function computeHoldingOwnerIncomes(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  grossRevenue: number,
): OwnerIncomeEntry[] {
  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  let totalWeight = 0
  const owned: { owner: import('../types/realEstateAsset').AssetOwnerRef; weight: number }[] = []
  for (const aId of assetIds) {
    const asset = state.realEstateAssets[aId]
    if (!asset) continue
    const w = estimateRealEstateAssetWeight(asset, config)
    totalWeight += w
    if (asset.owner) owned.push({ owner: asset.owner, weight: w })
  }
  if (totalWeight <= 0 || owned.length === 0) return []
  const result: OwnerIncomeEntry[] = []
  for (const oa of owned) {
    const income = grossRevenue * config.realEstateOwnerIncomeRate * (oa.weight / totalWeight)
    if (income > 0) result.push({ owner: oa.owner, income })
  }
  return result
}

export function estimateRealEstateSalePrice(
  state: WorldState,
  config: SimulationConfig,
  asset: RealEstateAsset,
): number {
  return (
    estimateWeeklyOwnerIncome(state, config, asset) *
    WEEKS_PER_YEAR *
    config.realEstateSalePriceYears
  )
}
