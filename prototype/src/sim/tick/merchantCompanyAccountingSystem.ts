import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { MerchantCompanyId, HouseId, HoldingId } from '../types/ids'
import type { MerchantCompany, TradeRoute } from '../types/merchant'
import type { House } from '../types/house'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { getSmoothedPriceOrBase } from '../config/resourceEconomyDefinitions'

// v0.61 §15/§16: 月次。ResourceEconomySystem の後・houseSurplusDistribution の後に走り、
//   route profit（当月清算価格）+ commerce revenue（前月 snapshot）を集計して
//   ownerDividend（House.wealth）+ retained（treasury）へ分配する。
//   wage / upper dividend mint は P6（employment provider 接続後）。RNG 非消費・決定的。

const PROFIT_SMOOTH_ALPHA = 0.25

function holdingStateId(state: WorldState, holdingId: HoldingId): string | undefined {
  const holding = state.holdings[holdingId]
  if (!holding) return undefined
  return state.provinces[holding.provinceId]?.stateId
}

// 当月清算価格（lastPrice）。snapshot 無ければ base price。
function currentPrice(state: WorldState, stateId: string, resource: ResourceKind): number {
  const ps = state.marketResourcePrices[marketResourcePriceKey(stateId, resource)]
  return getSmoothedPriceOrBase(ps?.lastPrice, resource)
}

// 前月 snapshot（history[last-1]）の (buy, sell, price)。tight loop を切るため当月値は使わない（§15.5）。
function prevPoint(
  state: WorldState,
  stateId: string,
  resource: ResourceKind,
): { buy: number; sell: number; price: number } | undefined {
  const ps = state.marketResourcePrices[marketResourcePriceKey(stateId, resource)]
  if (!ps || ps.history.length < 2) return undefined
  const p = ps.history[ps.history.length - 2]
  if (!p) return undefined
  return { buy: p.buyOrders, sell: p.sellOrders, price: p.price }
}

export function runMerchantCompanyAccountingSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const config = ctx.config
  const companyIds = (Object.keys(state.merchantCompanies) as MerchantCompanyId[])
    .filter((id) => state.merchantCompanies[id]?.status === 'active')
    .sort()
  if (companyIds.length === 0) return ctx

  const companiesMut = { ...state.merchantCompanies } as Record<MerchantCompanyId, MerchantCompany>
  const routesMut = { ...state.tradeRoutes }
  const housesMut = { ...state.houses } as Record<HouseId, House>

  for (const companyId of companyIds) {
    const company = companiesMut[companyId]
    if (!company) continue

    // --- route profit（当月清算価格 × lastQuantity=plannedQuantity）---
    let routeNetTotal = 0
    for (const routeId of (state.tradeRouteIndex.byCompany[companyId as string] ?? [])
      .slice()
      .sort()) {
      const route = routesMut[routeId]
      if (!route || route.status !== 'active') continue
      const q = route.plannedQuantity
      const sourcePrice = currentPrice(state, route.sourceStateId, route.resource)
      const targetPrice = currentPrice(state, route.targetStateId, route.resource)
      const avgPrice = (sourcePrice + targetPrice) / 2
      const arbitrage =
        q * Math.max(0, targetPrice - sourcePrice) * config.tradeRouteSpreadCaptureRate
      const serviceFee = q * avgPrice * config.tradeRouteServiceMarginRate
      const transport = q * config.tradeRouteTransportCostPerUnit // distanceModifier=1（隣接のみ）
      const maintenance = config.tradeRouteFixedMaintenanceCostByLevel[route.level] ?? 0
      const net = arbitrage + serviceFee - transport - maintenance
      routeNetTotal += net
      const updated: TradeRoute = {
        ...route,
        lastQuantity: q,
        lastBuyPrice: sourcePrice,
        lastSellPrice: targetPrice,
        lastProfit: net,
        smoothedProfit:
          route.smoothedProfit * (1 - PROFIT_SMOOTH_ALPHA) + net * PROFIT_SMOOTH_ALPHA,
      }
      routesMut[routeId] = updated
    }

    // --- commerce revenue（前月 snapshot・本店/支店ごと cap）---
    let commerceTotal = 0
    for (const estId of state.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ??
      []) {
      const est = state.merchantCompanyEstablishments[estId]
      if (!est || est.status !== 'active') continue
      const sid = holdingStateId(state, est.holdingId)
      if (!sid) continue
      let tradeValue = 0
      for (const r of RESOURCE_KINDS) {
        const p = prevPoint(state, sid, r)
        if (!p) continue
        tradeValue += (p.buy + p.sell) * p.price * 0.5
      }
      const share = config.merchantEstablishmentCommerceShareByKind[est.kind]
      const raw = tradeValue * share * est.level
      const cap = config.merchantCommerceRevenueCapByEstablishmentKind[est.kind]
      commerceTotal += Math.min(raw, cap)
    }

    // --- 分配（§16）---
    const gross = commerceTotal + routeNetTotal
    let treasuryDelta: number
    if (gross > 0) {
      const ownerDividend = gross * config.merchantCompanyOwnerDividendRate
      // wage/upper pool は P6 まで carve しない（mint 先 POP がまだ無い）→ retained=gross-ownerDividend。
      treasuryDelta = gross - ownerDividend
      const ownerHouse = housesMut[company.ownerHouseId]
      if (ownerHouse) {
        housesMut[company.ownerHouseId] = {
          ...ownerHouse,
          wealth: Math.max(0, ownerHouse.wealth + ownerDividend),
        }
      }
    } else {
      treasuryDelta = gross // 赤字は treasury が吸収
    }

    companiesMut[companyId] = {
      ...company,
      treasury: company.treasury + treasuryDelta,
      lastProfit: gross,
      smoothedProfit:
        company.smoothedProfit * (1 - PROFIT_SMOOTH_ALPHA) + gross * PROFIT_SMOOTH_ALPHA,
    }
  }

  return {
    ...ctx,
    state: {
      ...state,
      merchantCompanies: companiesMut,
      tradeRoutes: routesMut,
      houses: housesMut,
    },
  }
}
