import type { HoldingId, RealEstateAssetId, ProductionRecipeId } from './ids'
import type { ResourceKind } from './resource'

// v0.54 §5 価格履歴: StateRegion × ResourceKind ごとに保存する。
//   marketKey は stateRegionId を string 化したもの。key = `${marketKey}:${resource}`。
export type MarketResourcePricePoint = {
  week: number
  price: number
  supply: number
  effectiveDemand: number
  sold: number
  unmetDemand: number
}

export type MarketResourcePriceState = {
  marketKey: string
  resource: ResourceKind
  lastPrice: number
  smoothedPrice: number
  history: MarketResourcePricePoint[]
}

export function marketResourcePriceKey(marketKey: string, resource: ResourceKind): string {
  return `${marketKey}:${resource}`
}

// v0.54 §16 月次 snapshot: ResourceEconomySystem が出力する「生産と市場の結果」。
//   分配 (owner/due/seizure/chain/treasury) は LandRevenueSystem の責務であり snapshot は持たない (§16.1)。
//   全て per-month (4 週分をまとめて解決した値)。追加で ×4 してはならない (§16.1)。

// §16.5 ProductionRecipeResult: recipe 単位の結果 (主に debug / UI 用)。
export type ProductionRecipeResult = {
  recipeId: ProductionRecipeId
  slotCount: number
  allocatedLabor: number
  outputs: Partial<Record<ResourceKind, number>>
  inputs: Partial<Record<ResourceKind, number>>
  soldOutputs: Partial<Record<ResourceKind, number>>
  grossRevenue: number
  inputCost: number
  netRevenue: number
}

// §16.4 RealEstateProductionResult: asset 単位の結果。
export type RealEstateProductionResult = {
  assetId: RealEstateAssetId
  holdingId: HoldingId
  outputs: Partial<Record<ResourceKind, number>>
  inputs: Partial<Record<ResourceKind, number>>
  soldOutputs: Partial<Record<ResourceKind, number>>
  grossRevenue: number
  inputCost: number
  netRevenue: number
  recipeResults: ProductionRecipeResult[]
}

// §16.3 HoldingResourceRevenueSnapshot: holding 単位の月次 snapshot。
export type HoldingResourceRevenueSnapshot = {
  holdingId: HoldingId
  week: number
  // = Σ max(0, assetResults[].netRevenue)。観察用の holding 集計であり分配の課税基盤ではない (§16.3 / §17.1.1)。
  //   名称注意: asset 級 grossRevenue (原価控除前) とは別物。holding 級は net 集計なので totalNetRevenue。
  totalNetRevenue: number
  byResource: Partial<Record<ResourceKind, number>>
  assetResults: RealEstateProductionResult[]
}
