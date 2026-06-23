import type { PopGroup } from '../types/popGroup'
import type { ResourceKind } from '../types/resource'
import type { SimulationConfig } from '../config/defaultConfig'
import { computePopNeedDemand } from './resourceMarketSelectors'

// v0.60: POP が full-desired need を満たすのに要する金額（resourceEconomySystem の
//   tierCost と同一式: Σ buyOrders × price）。desiredValue は数量なので金額化が必須。
export function getPopPredictedLifeCost(
  pop: PopGroup,
  config: SimulationConfig,
  priceLookup: (resource: ResourceKind) => number,
): number {
  const needs = computePopNeedDemand(pop, config, priceLookup)
  let cost = 0
  for (const cat of needs) {
    for (const res of cat.resources) {
      cost += res.buyOrders * priceLookup(res.resource)
    }
  }
  return cost
}

// v0.60: 生活費 horizon を超える余剰のみ拠出可能（飢えた POP は 0）。
export function getPopContributableSurplus(
  pop: PopGroup,
  config: SimulationConfig,
  priceLookup: (resource: ResourceKind) => number,
): number {
  const lifeCost = getPopPredictedLifeCost(pop, config, priceLookup)
  const reserve = lifeCost * config.popContributionHorizonMonths
  return Math.max(0, pop.money - reserve)
}
