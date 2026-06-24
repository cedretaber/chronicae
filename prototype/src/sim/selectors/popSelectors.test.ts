import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withProvince, withHolding } from '../testFixtures'
import {
  getStateFoodSupply,
  getStateCarryingCapacity,
  getProvinceCarryingCapacity,
  getPerCapitaFoodNeed,
  getStateFoodRequirement,
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

  it('getPerCapitaFoodNeed は food カテゴリの profile×tierScale の和 (essential は popEssentialNeedScale)', () => {
    // peasants: staple_food 1.0 + protein 0.12 (essential ×scale) + fine_food 0 → scale × 1.12
    expect(getPerCapitaFoodNeed(defaultConfig, 'peasants')).toBeCloseTo(
      defaultConfig.popEssentialNeedScale * (1.0 + 0.12),
      6,
    )
    // nobles: staple 1.0 + protein 0.5 (×scale) + fine_food 0.25 (ordinary ×1) → scale×1.5 + 0.25
    expect(getPerCapitaFoodNeed(defaultConfig, 'nobles')).toBeCloseTo(
      defaultConfig.popEssentialNeedScale * (1.0 + 0.5) + 0.25,
      6,
    )
  })

  it('v0.60.3 carrying capacity は foodSupply / 人口加重 per-capita 食料需要', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, 'pr-0' as ProvinceId, {})
    s = withHolding(s, 'hd-0' as HoldingId, 'pr-0' as ProvinceId)
    s = withPop(s, 'hd-0' as HoldingId, 'lower', 100, true) // peasants
    s = withFoodSupply(s, 'sr-0', { grain: 300 })
    const need = getPerCapitaFoodNeed(defaultConfig, 'peasants')
    expect(getStateCarryingCapacity(s, defaultConfig, 'sr-0' as StateRegionId)).toBeCloseTo(
      300 / need,
      3,
    )
  })

  it('v0.60.3 食料需要総量は人口構成で加重される (peasants と nobles 混在)', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, 'pr-0' as ProvinceId, {})
    s = withHolding(s, 'hd-0' as HoldingId, 'pr-0' as ProvinceId)
    s = withPop(s, 'hd-0' as HoldingId, 'lower', 100, true) // peasants
    s = withPop(s, 'hd-0' as HoldingId, 'upper', 100, true) // nobles
    const requirement =
      100 * getPerCapitaFoodNeed(defaultConfig, 'peasants') +
      100 * getPerCapitaFoodNeed(defaultConfig, 'nobles')
    expect(getStateFoodRequirement(s, defaultConfig, 'sr-0' as StateRegionId)).toBeCloseTo(
      requirement,
      6,
    )
    // CC は人口加重 per-capita で割る: supply / (requirement / 総人口)。単一 popType だとゼロ人口
    //   fallback と一致して加重が検証されないため、混在ケースで CC も assert する。
    s = withFoodSupply(s, 'sr-0', { grain: 600 })
    const weightedPerCapita = requirement / 200
    expect(getStateCarryingCapacity(s, defaultConfig, 'sr-0' as StateRegionId)).toBeCloseTo(
      600 / weightedPerCapita,
      3,
    )
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
    s = withHolding(s, 'hd-0' as HoldingId, 'pr-0' as ProvinceId)
    s = withPop(s, 'hd-0' as HoldingId, 'lower', 50, true) // peasants
    s = withFoodSupply(s, 'sr-0', { grain: 250 })
    const need = getPerCapitaFoodNeed(defaultConfig, 'peasants')
    expect(getProvinceCarryingCapacity(s, defaultConfig, 'pr-0' as ProvinceId)).toBeCloseTo(
      250 / need,
      3,
    )
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
