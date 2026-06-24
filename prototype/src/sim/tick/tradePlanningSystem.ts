import type { TickContext } from './context'
import type { TradeRouteId } from '../types/ids'
import type { TradeRoute } from '../types/merchant'
import { marketResourcePriceKey } from '../types/resourceEconomy'

// v0.61 §13: 月次。ResourceEconomySystem の直前に走り、前月 market snapshot から各 active route の
//   plannedQuantity を算出する。2 相清算しないため lastQuantity = plannedQuantity（accounting で確定）。
//   cold-start（前月 snapshot 無し）は plannedQuantity=0。決定的・RNG 非消費。

// 前月 snapshot の (sellOrders, buyOrders) を読む。無ければ undefined。
function prevOrders(
  state: TickContext['state'],
  stateId: string,
  resource: TradeRoute['resource'],
): { sell: number; buy: number } | undefined {
  const ps = state.marketResourcePrices[marketResourcePriceKey(stateId, resource)]
  const last = ps?.history[ps.history.length - 1]
  if (!last) return undefined
  return { sell: last.sellOrders, buy: last.buyOrders }
}

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

    const throughput = config.tradeRouteThroughputByLevel[route.level] ?? 0
    const source = prevOrders(state, route.sourceStateId, route.resource)
    const target = prevOrders(state, route.targetStateId, route.resource)

    let planned = 0
    if (source && target) {
      const sourceExportable = Math.max(0, source.sell - source.buy)
      const targetImportDemand = Math.max(0, target.buy - target.sell)
      planned = Math.min(throughput, sourceExportable, targetImportDemand)
    }
    // cold-start（前月 snapshot 無し）は planned=0。

    tradeRoutesMut[routeId] = { ...route, plannedQuantity: planned, plannedWeek: week }
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
