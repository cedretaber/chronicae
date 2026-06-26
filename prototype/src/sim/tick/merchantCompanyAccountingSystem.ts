import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { MerchantCompanyId, HouseId, HoldingId } from '../types/ids'
import type { MerchantCompany, TradeRoute } from '../types/merchant'
import type { House } from '../types/house'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'
import type { PopType } from '../types/popGroup'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { getSmoothedPriceOrBase } from '../config/resourceEconomyDefinitions'
import { getMerchantEstablishmentEmploymentSlots } from '../config/merchantDefinitions'
import { isEmployed } from '../types/workplaceRef'

// v0.61 §15/§16: 月次。ResourceEconomySystem の後・houseSurplusDistribution の後に走り、
//   route profit（当月清算価格）+ commerce revenue（前月 snapshot）を gross に集計し、§16.6 で
//   wage（雇用 POP へ mint）/ upper 配当（雇用 patricians へ mint）/ owner 配当（House.wealth）/
//   retained（treasury）へ分配する。carve==mint（mint 先不在 pool は treasury に残す）。RNG 非消費・決定的。

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
  const popGroupsMut = { ...state.popGroups }

  // §16.6: holding 内の employed POP（popType 指定）に wage を mint する。実際に mint した額を返す
  //   （carve==mint: 雇用 POP 不在なら 0 を返し、呼び出し側は carve しない＝treasury に残す）。
  const mintToEmployed = (holdingId: HoldingId, popType: PopType, amount: number): number => {
    if (amount <= 0) return 0
    for (const pid of state.popIndex.byHolding[holdingId] ?? []) {
      const pop = popGroupsMut[pid]
      if (!pop || pop.popType !== popType || !isEmployed(pop)) continue
      popGroupsMut[pid] = { ...pop, money: pop.money + amount }
      return amount
    }
    return 0
  }

  for (const companyId of companyIds) {
    const company = companiesMut[companyId]
    if (!company) continue

    // --- route profit（planning price 基準・§方針3）---
    //   profit は TradePlanning が保存した前月 smoothedPrice（plannedBuyPrice/plannedSellPrice）で計算。
    //   当月清算価格（lastPrice）は lastBuyPrice/lastSellPrice として UI/probe 用に保存するが、利益計算には使わない。
    let routeNetTotal = 0
    for (const routeId of (state.tradeRouteIndex.byCompany[companyId as string] ?? [])
      .slice()
      .sort()) {
      const route = routesMut[routeId]
      if (!route || route.status !== 'active') continue
      const q = route.plannedQuantity
      const plannedSpread = route.plannedSellPrice - route.plannedBuyPrice
      const avgPlanned = (route.plannedBuyPrice + route.plannedSellPrice) / 2
      const arbitrage = q * Math.max(0, plannedSpread) * config.tradeRouteSpreadCaptureRate
      const serviceFee = q * avgPlanned * config.tradeRouteServiceMarginRate
      const transport = q * config.tradeRouteTransportCostPerUnit
      const maintenance =
        (config.tradeRouteFixedMaintenanceCostByLevel[route.level] ?? 0) +
        q * config.tradeRouteVariableMaintenanceCostPerUnit
      const net = arbitrage + serviceFee - transport - maintenance
      routeNetTotal += net
      const updated: TradeRoute = {
        ...route,
        lastQuantity: q,
        lastBuyPrice: currentPrice(state, route.sourceStateId, route.resource),
        lastSellPrice: currentPrice(state, route.targetStateId, route.resource),
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

    // --- 分配（§16.6）: gross>0 を wage（雇用 POP へ mint）/ upper 配当（雇用 patricians へ mint）/
    //   owner 配当（House.wealth）/ retained（treasury）へ切り出す。carve==mint: mint 先 POP 不在の
    //   pool は treasury に残す（money 消失を防ぐ）。施設 slot 比で各 establishment へ按分する。
    const gross = commerceTotal + routeNetTotal
    let treasuryDelta: number
    if (gross > 0) {
      const activeEsts = (
        state.merchantCompanyEstablishmentIndex.byCompany[companyId as string] ?? []
      )
        .map((id) => state.merchantCompanyEstablishments[id])
        .filter((e): e is NonNullable<typeof e> => !!e && e.status === 'active')

      // popType 別 slot 合計（按分の分母）。wage = merchants/scribes/laborers、upper = patricians。
      const WAGE_TYPES: PopType[] = ['merchants', 'scribes', 'laborers']
      let totalWageSlots = 0
      let totalUpperSlots = 0
      for (const est of activeEsts) {
        for (const t of WAGE_TYPES) {
          totalWageSlots += getMerchantEstablishmentEmploymentSlots(est.kind, t, est.level)
        }
        totalUpperSlots += getMerchantEstablishmentEmploymentSlots(
          est.kind,
          'patricians',
          est.level,
        )
      }

      const wagePool = gross * config.merchantCompanyWageShare
      const upperPool = gross * config.merchantCompanyUpperDividendShare
      let wageMinted = 0
      let upperMinted = 0
      if (totalWageSlots > 0 && wagePool > 0) {
        for (const est of activeEsts) {
          for (const t of WAGE_TYPES) {
            const slots = getMerchantEstablishmentEmploymentSlots(est.kind, t, est.level)
            if (slots <= 0) continue
            wageMinted += mintToEmployed(est.holdingId, t, wagePool * (slots / totalWageSlots))
          }
        }
      }
      if (totalUpperSlots > 0 && upperPool > 0) {
        for (const est of activeEsts) {
          const slots = getMerchantEstablishmentEmploymentSlots(est.kind, 'patricians', est.level)
          if (slots <= 0) continue
          upperMinted += mintToEmployed(
            est.holdingId,
            'patricians',
            upperPool * (slots / totalUpperSlots),
          )
        }
      }

      // carve==mint: ownerHouse 不在なら配当を carve しない（wage/upper と同じ minted-only 規律）。
      const ownerHouse = housesMut[company.ownerHouseId]
      const ownerDividendPaid = ownerHouse ? gross * config.merchantCompanyOwnerDividendRate : 0
      treasuryDelta = gross - ownerDividendPaid - wageMinted - upperMinted
      if (ownerHouse) {
        housesMut[company.ownerHouseId] = {
          ...ownerHouse,
          wealth: Math.max(0, ownerHouse.wealth + ownerDividendPaid),
        }
      }
    } else {
      treasuryDelta = gross // 赤字は treasury が吸収
    }

    const newTreasury = company.treasury + treasuryDelta
    const newSmoothed =
      company.smoothedProfit * (1 - PROFIT_SMOOTH_ALPHA) + gross * PROFIT_SMOOTH_ALPHA
    // §20.1: 経営難の連続週を distressSince で追う（status 変更は cleanupMerchantSystem の責務＝
    //   byStatus index を一括同期させるため）。回復で distressSince をクリア。
    const distressed =
      newTreasury < config.merchantCompanyBankruptcyTreasuryThreshold && newSmoothed < 0
    const distressSince = distressed ? (company.distressSince ?? state.absoluteWeek) : undefined

    companiesMut[companyId] = {
      ...company,
      treasury: newTreasury,
      lastProfit: gross,
      smoothedProfit: newSmoothed,
      ...(distressSince !== undefined ? { distressSince } : {}),
    }
    if (distressSince === undefined && company.distressSince !== undefined) {
      // 回復: distressSince を消す。
      const recovered = { ...companiesMut[companyId] }
      delete recovered.distressSince
      companiesMut[companyId] = recovered
    }
  }

  return {
    ...ctx,
    state: {
      ...state,
      merchantCompanies: companiesMut,
      tradeRoutes: routesMut,
      houses: housesMut,
      popGroups: popGroupsMut,
    },
  }
}
