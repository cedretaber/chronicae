import type { HoldingId, RealEstateAssetId, ProductionRecipeId } from './ids'
import type { ResourceKind } from './resource'

// v0.54 §5 / 市場清算 rewrite (§6.3c.1) 価格履歴: StateRegion × ResourceKind ごとに保存する。
//   marketKey は stateRegionId を string 化したもの。key = `${marketKey}:${resource}`。
//   基本語彙は sellOrders (生産者が売りに出した量) / buyOrders (POP・workshop が求めた量)。
//   producerRevenue=sellOrders×price / consumerCost=buyOrders×price。
//   fulfillmentRatio = buyOrders≤0 ? 1 : clamp(sellOrders/buyOrders, 0, 1)。shortageSeverity ∈ [0,1]。
export type MarketResourcePricePoint = {
  week: number
  price: number
  sellOrders: number
  buyOrders: number
  producerRevenue: number
  consumerCost: number
  fulfillmentRatio: number
  shortage: boolean
  shortageSeverity: number
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

// v0.56 UI 用 per-recipe 内訳。ResourceEconomySystem は recipe 単位で原材料・産出・収支を計算してから
//   asset 単位に集約するが (§12.5)、UI で「原材料→処理→産出」をレシピ別に見せるため内訳を保持する。
//   read-model 専用 (integrity・分配・生産計算は参照しない)。outputs/inputs は ResourceKind 解決済み
//   (InputCategory ではなく実消費 resource)。monthlyHoldingResourceRevenue 同様に月次上書き。
export type RecipeProductionBreakdown = {
  recipeId: ProductionRecipeId
  outputs: Partial<Record<ResourceKind, number>>
  inputs: Partial<Record<ResourceKind, number>>
  grossRevenue: number
  inputCost: number
  netRevenue: number
  // v0.56 観察用充足率 (recipe 単位)。inputFulfillment: raw Liebig 最小律 (recipeInputScale, 0..1)。
  //   input 無し recipe は 1。UI はレシピ別に提示し、施設/カード要約は min (ボトルネック) を取る。
  //   (v0.57: laborTypeFulfillment は撤去。労働は施設全体の雇用充足率を UI 側で直接算出する。)
  inputFulfillment: number
}

// §16.4 RealEstateProductionResult: asset 単位の結果。
export type RealEstateProductionResult = {
  assetId: RealEstateAssetId
  holdingId: HoldingId
  outputs: Partial<Record<ResourceKind, number>>
  inputs: Partial<Record<ResourceKind, number>>
  // v0.56 read-model: recipe 別内訳 (market.recipes 出現順 = 決定的)。
  recipeBreakdown: RecipeProductionBreakdown[]
  grossRevenue: number
  inputCost: number
  netRevenue: number
  // v0.58: netRevenue から労働者(lower/middle)へ carve した賃金額 (= 実際に mint された money の合計)。
  //   landRevenueSystem は positiveNet = max(0, netRevenue − wageShare − ownerDividendShare) で控除する。
  //   carve==mint 不変条件: 分配不能 (雇用 PopType 不在) のときは 0 (owner から引かない)。
  wageShare: number
  // v0.58 balance: netRevenue から雇用 upper(nobles/patricians)へ carve した**配当**額 (= mint された合計)。
  //   賃金とは別 carve (所有者・支配者の取り分)。雇用 upper 不在なら 0 (owner から引かない＝carve==mint)。
  ownerDividendShare: number
  // v0.55 観察用充足率 (asset の recipe を slotCount 加重平均)。分配・生産計算には使わず UI/digest 専用。
  //   inputFulfillment: raw Liebig 最小律 (recipeInputScale, 0..1)。入力がどれだけ市場供給で満たされたか。
  //     これ自体が低いほど産出ペナルティ大 (floor 付き modifier 経由)。input 無し raw recipe は 1。
  //   (v0.57: laborTypeFulfillment は撤去。労働は施設全体の雇用充足率を UI 側で直接算出する。)
  inputFulfillment: number
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
