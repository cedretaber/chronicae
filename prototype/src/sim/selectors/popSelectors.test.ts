import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import {
  getStateFoodSupply,
  getStateCarryingCapacity,
  getProvinceCarryingCapacity,
} from './popSelectors'
import { defaultConfig } from '../config/defaultConfig'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import type { MarketResourcePriceState } from '../types/resourceEconomy'
import type { WorldState } from '../types/world'
import type { StateRegionId, ProvinceId } from '../types/ids'
import type { ResourceKind } from '../types/resource'

function withFoodSupply(
  state: WorldState,
  stateId: string,
  supplies: Partial<Record<ResourceKind, number>>,
): WorldState {
  const prices = { ...state.marketResourcePrices }
  for (const [resource, sell] of Object.entries(supplies) as [ResourceKind, number][]) {
    const key = marketResourcePriceKey(stateId, resource)
    const ps: MarketResourcePriceState = {
      marketKey: stateId,
      resource,
      lastPrice: 1,
      smoothedPrice: 1,
      history: [
        {
          week: 1,
          price: 1,
          sellOrders: sell,
          buyOrders: 0,
          producerRevenue: 0,
          consumerCost: 0,
          fulfillmentRatio: 1,
          shortage: false,
          shortageSeverity: 0,
        },
      ],
    }
    prices[key] = ps
  }
  return { ...state, marketResourcePrices: prices }
}

describe('food-based carrying capacity', () => {
  it('getStateFoodSupply は food 資源の sellOrders × food value を合計する', () => {
    let s = makeEmptyV016State()
    // grain(value 1.0) 200 + smoked_fish(value 1.5) 100 + beer(食料でない) 999
    s = withFoodSupply(s, 'sr-0', { grain: 200, smoked_fish: 100, beer: 999 })
    expect(getStateFoodSupply(s, 'sr-0' as StateRegionId)).toBeCloseTo(200 * 1.0 + 100 * 1.5, 3)
  })

  it('carrying capacity は state の食料供給 / perCapitaFoodNeed に比例する', () => {
    let s = makeEmptyV016State()
    s = withFoodSupply(s, 'sr-0', { grain: 300 })
    // perCapitaFoodNeed=1.0 → 300
    expect(getStateCarryingCapacity(s, defaultConfig, 'sr-0' as StateRegionId)).toBeCloseTo(300, 0)
  })

  it('食料供給ゼロでも minProvinceCarryingCapacity を下回らない', () => {
    const s = makeEmptyV016State()
    expect(getStateCarryingCapacity(s, defaultConfig, 'sr-0' as StateRegionId)).toBe(
      defaultConfig.minProvinceCarryingCapacity,
    )
  })

  it('getProvinceCarryingCapacity は province の state の food carrying capacity を返す', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, 'pr-0' as ProvinceId, {})
    s = withFoodSupply(s, 'sr-0', { grain: 250 })
    expect(getProvinceCarryingCapacity(s, defaultConfig, 'pr-0' as ProvinceId)).toBeCloseTo(250, 0)
  })
})
