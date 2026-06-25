import type { TickContext } from './context'
import type { TradeRouteId } from '../types/ids'
import type { TradeRoute } from '../types/merchant'
import { computeExpectedRouteEconomics } from '../selectors/merchantSelectors'

// v0.61 fix: 月次。ResourceEconomySystem の直前に走り、前月 smoothedPrice（EWMA）の価格差・期待利益から
//   各 active route の plannedQuantity を算出する。瞬間値 lastPrice でなく smoothedPrice を読むことで
//   注入由来の 2 サイクル振動を内蔵ダンパーで減衰させる（§方針A）。計算は共有ヘルパー
//   computeExpectedRouteEconomics に集約（§方針C）。決定的・RNG 非消費。

export function runTradePlanningSystem(ctx: TickContext): TickContext {
  const state = ctx.state
  const config = ctx.config
  const routeIds = (Object.keys(state.tradeRoutes) as TradeRouteId[]).sort()
  if (routeIds.length === 0) return ctx

  const week = state.absoluteWeek
  const tradeRoutesMut = { ...state.tradeRoutes }
  let changed = false

  for (const routeId of routeIds) {
    const route = state.tradeRoutes[routeId]
    if (!route || route.status !== 'active') continue

    const econ = computeExpectedRouteEconomics(state, config, {
      sourceStateId: route.sourceStateId,
      targetStateId: route.targetStateId,
      resource: route.resource,
      level: route.level,
    })

    tradeRoutesMut[routeId] = {
      ...route,
      plannedQuantity: econ.plannedQuantity,
      plannedWeek: week,
      plannedBuyPrice: econ.sourcePrice,
      plannedSellPrice: econ.targetPrice,
      plannedExpectedUnitMargin: econ.expectedUnitMargin,
    }
    changed = true
  }

  if (!changed) return ctx
  return { ...ctx, state: { ...state, tradeRoutes: tradeRoutesMut } }
}

// ResourceEconomySystem が参照する「state ごとの external trade order」。
//   export（source 側の追加需要 = 価格↑）と import（target 側の追加供給 = 価格↓）を resource 別に集計。
export type ExternalTradeOrders = Map<
  string,
  {
    exportDemand: Partial<Record<TradeRoute['resource'], number>>
    importSupply: Partial<Record<TradeRoute['resource'], number>>
  }
>

export function computeExternalTradeOrders(state: TickContext['state']): ExternalTradeOrders {
  const out: ExternalTradeOrders = new Map()
  const ensure = (stateId: string) => {
    let e = out.get(stateId)
    if (!e) {
      e = { exportDemand: {}, importSupply: {} }
      out.set(stateId, e)
    }
    return e
  }
  for (const routeId of (Object.keys(state.tradeRoutes) as TradeRouteId[]).sort()) {
    const route = state.tradeRoutes[routeId]
    if (!route || route.status !== 'active') continue
    const q = route.plannedQuantity
    if (q <= 0) continue
    const src = ensure(route.sourceStateId)
    src.exportDemand[route.resource] = (src.exportDemand[route.resource] ?? 0) + q
    const tgt = ensure(route.targetStateId)
    tgt.importSupply[route.resource] = (tgt.importSupply[route.resource] ?? 0) + q
  }
  return out
}
