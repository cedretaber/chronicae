import type { WorldState } from '../types/world'
import type {
  MerchantCompanyId,
  TradeRouteId,
  HouseId,
  PersonId,
  StateRegionId,
  HoldingId,
  ProductionRecipeId,
} from '../types/ids'
import type { MerchantCompany, TradeRoute, MerchantCompanyEstablishment } from '../types/merchant'
import type { ResourceKind } from '../types/resource'
import type { PopType } from '../types/popGroup'
import type { SimulationConfig } from '../config/defaultConfig'
import { isLivingPerson } from '../types/person'
import { getHouseDecisionMaker, getActiveOfficeHolders } from './officeSelectors'
import { PRODUCTION_RECIPE_DEFINITIONS } from '../config/productionRecipeDefinitions'
import { MERCHANT_EMPLOYMENT_SLOTS_PER_LEVEL } from '../config/merchantDefinitions'
import {
  getSmoothedPriceOrBase,
  RESOURCE_PRICE_DEFINITIONS,
} from '../config/resourceEconomyDefinitions'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { clamp } from '../utils/math'

// v0.61 §16.6: holding 内の active 商会施設が提供する popType 別雇用枠の合計。
//   dormant/closed は除外（status 判定）。capacity 統合の merchantTerm として使う。
export function getHoldingMerchantEmploymentSlots(
  state: WorldState,
  holdingId: HoldingId,
): Partial<Record<PopType, number>> {
  const result: Partial<Record<PopType, number>> = {}
  for (const estId of state.merchantCompanyEstablishmentIndex.byHolding[holdingId as string] ??
    []) {
    const est = state.merchantCompanyEstablishments[estId]
    if (!est || est.status !== 'active') continue
    const perLevel = MERCHANT_EMPLOYMENT_SLOTS_PER_LEVEL[est.kind]
    for (const [popType, slots] of Object.entries(perLevel) as [PopType, number][]) {
      result[popType] = (result[popType] ?? 0) + slots * Math.max(0, est.level)
    }
  }
  return result
}

// v0.61 商会 query selector。隣接 StateRegion 導出・会長選出・排他 guard を集約する。

export function getMerchantCompany(
  state: WorldState,
  companyId: MerchantCompanyId,
): MerchantCompany | undefined {
  return state.merchantCompanies[companyId]
}

export function isMerchantCompanyActive(state: WorldState, companyId: MerchantCompanyId): boolean {
  return state.merchantCompanies[companyId]?.status === 'active'
}

// 商会の share holder のうち rawPower 最大の alive normal Person。
//   tie-break は holderPersonId 昇順。share holder 不在なら ownerHouse の decision maker。
export function getMerchantCompanyDecisionMaker(
  state: WorldState,
  companyId: MerchantCompanyId,
): PersonId | undefined {
  const company = state.merchantCompanies[companyId]
  if (!company) return undefined

  const shareIds = state.merchantCompanyShareIndex.byCompany[companyId as string] ?? []
  const shares = shareIds
    .flatMap((id) => {
      const s = state.merchantCompanyShares[id]
      return s && isLivingPerson(state.persons[s.holderPersonId]) ? [s] : []
    })
    .sort((a, b) => (a.holderPersonId as string).localeCompare(b.holderPersonId))

  let best: { id: PersonId; power: number } | undefined
  for (const share of shares) {
    if (!best || share.rawPower > best.power) {
      best = { id: share.holderPersonId, power: share.rawPower }
    }
  }
  if (best) return best.id

  return getHouseDecisionMaker(state, company.ownerHouseId)
}

// 商会の establishment / route を引く小 selector。
export function getCompanyEstablishments(
  state: WorldState,
  companyId: MerchantCompanyId,
): MerchantCompanyEstablishment[] {
  const ids = state.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? []
  return ids.flatMap((id) => {
    const e = state.merchantCompanyEstablishments[id]
    return e ? [e] : []
  })
}

export function getCompanyHeadquarters(
  state: WorldState,
  companyId: MerchantCompanyId,
): MerchantCompanyEstablishment | undefined {
  const company = state.merchantCompanies[companyId]
  if (!company) return undefined
  return state.merchantCompanyEstablishments[company.headquartersEstablishmentId]
}

export function getCompanyRoutes(state: WorldState, companyId: MerchantCompanyId): TradeRoute[] {
  const ids = state.tradeRouteIndex.byCompany[companyId as string] ?? []
  return ids.flatMap((id) => {
    const r = state.tradeRoutes[id]
    return r ? [r] : []
  })
}

export function getActiveRouteCount(state: WorldState, companyId: MerchantCompanyId): number {
  return getCompanyRoutes(state, companyId).filter((r) => r.status === 'active').length
}

// v0.61 §22: 当該 StateRegion を source または target とする交易路（重複排除・id 昇順）。
//   市場詳細パネルの「この市場に接続された交易路」表示に使う。
export function getStateConnectedRoutes(state: WorldState, stateId: StateRegionId): TradeRoute[] {
  const ids = new Set<string>()
  for (const id of state.tradeRouteIndex.bySourceState[stateId as string] ?? []) ids.add(id)
  for (const id of state.tradeRouteIndex.byTargetState[stateId as string] ?? []) ids.add(id)
  return [...ids]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((id) => {
      const r = state.tradeRoutes[id as TradeRouteId]
      return r ? [r] : []
    })
}

// 商会 Project の候補人物 (§7.3)。会長 → 番頭 → share holder → ownerHouse member の順、
//   いずれも alive normal Person。重複は除き、決定的順序を保つ。
export function getMerchantCompanyCandidatePersonIds(
  state: WorldState,
  companyId: MerchantCompanyId,
): PersonId[] {
  const company = state.merchantCompanies[companyId]
  if (!company) return []
  const seen = new Set<string>()
  const out: PersonId[] = []
  const add = (id: PersonId | undefined): void => {
    if (!id) return
    if (seen.has(id)) return
    if (!isLivingPerson(state.persons[id])) return
    seen.add(id)
    out.push(id)
  }

  add(getMerchantCompanyDecisionMaker(state, companyId))
  for (const holder of getActiveOfficeHolders(
    state,
    { kind: 'merchant_company', id: companyId },
    'administrator',
  )) {
    add(holder)
  }
  const shareIds = [...(state.merchantCompanyShareIndex.byCompany[companyId as string] ?? [])].sort(
    (a, b) => (a as string).localeCompare(b),
  )
  for (const sid of shareIds) {
    const s = state.merchantCompanyShares[sid]
    if (s) add(s.holderPersonId)
  }
  const ownerHouse = state.houses[company.ownerHouseId]
  if (ownerHouse && ownerHouse.active) {
    for (const memberId of [...ownerHouse.memberIds].sort((a, b) =>
      (a as string).localeCompare(b),
    )) {
      add(memberId)
    }
  }
  return out
}

// StateRegion 隣接: state A と B に属する province が越境隣接していれば隣接とみなす (§19.5)。
export function getAdjacentStateRegionIds(
  state: WorldState,
  stateId: StateRegionId,
): StateRegionId[] {
  const region = state.states[stateId]
  if (!region) return []
  const adjacent = new Set<string>()
  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const neighborId of province.neighbors) {
      const neighbor = state.provinces[neighborId]
      if (!neighbor) continue
      const neighborStateId = neighbor.stateId
      if (neighborStateId && (neighborStateId as string) !== (stateId as string)) {
        adjacent.add(neighborStateId)
      }
    }
  }
  return [...adjacent].sort().map((s) => s as StateRegionId)
}

// state 内の代表 city Holding（最小 id）。本店設置先（§19.1）。
export function getStateCityHoldingId(
  state: WorldState,
  stateId: StateRegionId,
): HoldingId | undefined {
  const region = state.states[stateId]
  if (!region) return undefined
  const cityIds: HoldingId[] = []
  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const hid of province.holdingIds) {
      const holding = state.holdings[hid]
      if (holding && holding.kind === 'city') cityIds.push(hid)
    }
  }
  cityIds.sort((a, b) => (a as string).localeCompare(b))
  return cityIds[0]
}

// state の資源生産ポテンシャル推定（§19.4）。確定済み RealEstateAsset の recipe 出力 × level を
//   resource ごとに集計する。worldgen 時点（価格履歴なし）の初期 route heuristic に使う。
export function estimateStateProductionPotential(
  state: WorldState,
  stateId: StateRegionId,
): Partial<Record<ResourceKind, number>> {
  const out: Partial<Record<ResourceKind, number>> = {}
  const region = state.states[stateId]
  if (!region) return out
  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const hid of province.holdingIds) {
      const assetIds = state.realEstateAssetIndex.byHolding[hid as string] ?? []
      for (const aid of assetIds) {
        const asset = state.realEstateAssets[aid]
        if (!asset) continue
        for (const recipeId of Object.keys(asset.recipeSlots) as ProductionRecipeId[]) {
          const weight = asset.recipeSlots[recipeId] ?? 0
          if (weight <= 0) continue
          const recipe = PRODUCTION_RECIPE_DEFINITIONS[recipeId]
          if (!recipe) continue
          for (const o of recipe.outputs) {
            out[o.resource] = (out[o.resource] ?? 0) + o.amount * asset.level * weight
          }
        }
      }
    }
  }
  return out
}

// 商家/貴族排他 guard (§10.3)。
// NOTE (v0.61 self-review): 現状この排他は **構造的に成立済み**で、これらの guard は未配線。
//   商会 owner は worldgen seed / runtime 再興のいずれも専用の新規 `dh-` House として作られ、polity を
//   持たない。商会所有権を既存の polity 所有 House へ移す機構も存在しない。したがって「polity 所有 House が
//   商会も所有する」状態は発生しえない。将来 商会の所有権移転・買収を導入した時点で、候補列挙
//   （worldgen distributeHouses / polity owner 選定 / merchantCompanyFoundingSystem）にこれらを差す。
export function canHouseOwnMerchantCompany(state: WorldState, houseId: HouseId): boolean {
  const ids = state.polityIndex.byOwnerHouse[houseId] ?? []
  return ids.every((id) => !state.polities[id]?.active)
}

export function canHouseOwnPolity(state: WorldState, houseId: HouseId): boolean {
  const ids = state.merchantCompanyIndex.byOwnerHouse[houseId as string] ?? []
  return ids.every((id) => state.merchantCompanies[id]?.status !== 'active')
}

// v0.61 fix（§方針1/3/5）: 交易路の期待経済性を前月 smoothedPrice の価格差・throughput・固定/従量維持費から
//   決定的に算出する単一の純関数。TradePlanning（plannedQuantity 決定）/ candidate 評価（open/upgrade）/
//   probe が同一式を共有し drift しない。Accounting は本関数が route に保存した planning 価格を読む。
//   RNG 非消費。distanceModifier=1（隣接のみ）。
export type ExpectedRouteEconomics = {
  sourcePrice: number
  targetPrice: number
  spread: number
  averagePrice: number
  spreadRatio: number
  spreadFactor: number
  sourceExportableAmount: number
  routeThroughput: number
  plannedQuantity: number
  unitArbitrage: number
  unitServiceFee: number
  unitTransportCost: number
  expectedUnitMargin: number
  expectedMaintenance: number
  expectedMonthlyProfit: number
}

// 前月 snapshot の smoothedPrice。TradePlanning は resourceEconomy 清算の前に走るため、ps.smoothedPrice は
//   当月清算を未反映＝前月の EWMA を指す（§方針A）。snapshot 無し（cold-start）は basePrice fallback。
function marketSmoothedPrice(
  state: WorldState,
  stateId: StateRegionId,
  resource: ResourceKind,
): number {
  const ps = state.marketResourcePrices[marketResourcePriceKey(stateId, resource)]
  return getSmoothedPriceOrBase(ps?.smoothedPrice, resource)
}

// 前月 snapshot の生注文量。source の輸出余力 sourceExportable=max(0,sell-buy) に使う（soft cap）。
export function marketLastOrders(
  state: WorldState,
  stateId: StateRegionId,
  resource: ResourceKind,
): { sell: number; buy: number } {
  const ps = state.marketResourcePrices[marketResourcePriceKey(stateId, resource)]
  const last = ps?.history[ps.history.length - 1]
  return last ? { sell: last.sellOrders, buy: last.buyOrders } : { sell: 0, buy: 0 }
}

export function computeExpectedRouteEconomics(
  state: WorldState,
  config: SimulationConfig,
  input: {
    sourceStateId: StateRegionId
    targetStateId: StateRegionId
    resource: ResourceKind
    level: number
  },
): ExpectedRouteEconomics {
  const { sourceStateId, targetStateId, resource, level } = input
  const sourcePrice = marketSmoothedPrice(state, sourceStateId, resource)
  const targetPrice = marketSmoothedPrice(state, targetStateId, resource)
  const spread = targetPrice - sourcePrice
  const averagePrice = (sourcePrice + targetPrice) / 2
  const spreadRatio = spread / Math.max(averagePrice, config.resourceMarketSupplyEpsilon)
  const spreadFactor = clamp(spreadRatio / config.tradeRouteFullUtilizationSpreadRatio, 0, 1)

  const src = marketLastOrders(state, sourceStateId, resource)
  const sourceExportableAmount = Math.max(0, src.sell - src.buy)
  const routeThroughput = config.tradeRouteThroughputByLevel[level] ?? 0

  const unitArbitrage = Math.max(0, spread) * config.tradeRouteSpreadCaptureRate
  const unitServiceFee = averagePrice * config.tradeRouteServiceMarginRate
  const transportMultiplier = RESOURCE_PRICE_DEFINITIONS[resource].transportCostMultiplier
  const unitTransportCost = config.tradeRouteTransportCostPerUnit * transportMultiplier
  const expectedUnitMargin = unitArbitrage + unitServiceFee - unitTransportCost

  // spread<=0 は spreadFactor=0 で planned=0、expectedUnitMargin<=0（高 transport / 低 avgPrice）も planned=0。
  const plannedQuantity =
    expectedUnitMargin <= 0 ? 0 : Math.min(routeThroughput, sourceExportableAmount) * spreadFactor

  const expectedMaintenance =
    (config.tradeRouteFixedMaintenanceCostByLevel[level] ?? 0) +
    plannedQuantity * config.tradeRouteVariableMaintenanceCostPerUnit
  const expectedMonthlyProfit = plannedQuantity * expectedUnitMargin - expectedMaintenance

  return {
    sourcePrice,
    targetPrice,
    spread,
    averagePrice,
    spreadRatio,
    spreadFactor,
    sourceExportableAmount,
    routeThroughput,
    plannedQuantity,
    unitArbitrage,
    unitServiceFee,
    unitTransportCost,
    expectedUnitMargin,
    expectedMaintenance,
    expectedMonthlyProfit,
  }
}
