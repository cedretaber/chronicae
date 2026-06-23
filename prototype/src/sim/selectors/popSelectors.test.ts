import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withProvince, withHolding } from '../testFixtures'
import {
  getStateFoodSupply,
  getStateCarryingCapacity,
  getProvinceCarryingCapacity,
  hasEmploymentSlack,
} from './popSelectors'
import { defaultConfig } from '../config/defaultConfig'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import type { MarketResourcePriceState } from '../types/resourceEconomy'
import type { PopGroup } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { StateRegionId, ProvinceId, HoldingId, PopGroupId } from '../types/ids'
import type { ResourceKind } from '../types/resource'
import type { PopClass } from '../types/popGroup'

let popCounter = 0
function withPop(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  size: number,
  employed: boolean,
): WorldState {
  const id = ('pg-slack-' + popCounter++) as PopGroupId
  const pop: PopGroup = {
    id,
    holdingId,
    class: popClass,
    popType: popClass === 'lower' ? 'peasants' : popClass === 'middle' ? 'freeholders' : 'nobles',
    employed,
    size,
    money: 0,
    needSatisfaction: 50,
    unrest: 0,
    attitudes: {},
  }
  const existing = state.popIndex.byHolding[holdingId] ?? []
  return {
    ...state,
    popGroups: { ...state.popGroups, [id]: pop },
    popIndex: { byHolding: { ...state.popIndex.byHolding, [holdingId]: [...existing, id] } },
  }
}

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

describe('hasEmploymentSlack (v0.55 §B)', () => {
  function setup(): { state: WorldState; hd: HoldingId } {
    let s = makeEmptyV016State()
    s = withProvince(s, 'pr-0' as ProvinceId, {})
    const hd = 'h-slack' as HoldingId
    s = withHolding(s, hd, 'pr-0' as ProvinceId, {})
    return { state: s, hd }
  }

  it('閾値以上の失業 POP がいれば true', () => {
    const { state, hd } = setup()
    const s = withPop(
      state,
      hd,
      'lower',
      defaultConfig.developRealEstateEmploymentSlackThreshold,
      false,
    )
    expect(hasEmploymentSlack(s, defaultConfig, hd)).toBe(true)
  })

  it('閾値未満の失業 POP では false', () => {
    const { state, hd } = setup()
    const s = withPop(
      state,
      hd,
      'lower',
      defaultConfig.developRealEstateEmploymentSlackThreshold - 1,
      false,
    )
    expect(hasEmploymentSlack(s, defaultConfig, hd)).toBe(false)
  })

  it('就業済み POP は失業スラックに数えない', () => {
    const { state, hd } = setup()
    const s = withPop(state, hd, 'lower', 100, true)
    expect(hasEmploymentSlack(s, defaultConfig, hd)).toBe(false)
  })
})
