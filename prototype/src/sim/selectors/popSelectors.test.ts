import { describe, it, expect } from 'vitest'
import { normalizePopEmploymentMut } from '../tick/employmentRebalanceSystem'
import { makeEmptyV016State, withProvince, withHolding } from '../testFixtures'
import {
  getStateFoodSupply,
  getStateCarryingCapacity,
  getProvinceCarryingCapacity,
  getPerCapitaFoodNeed,
  getStateFoodRequirement,
  hasEmploymentSlack,
  getHoldingPopTypeCapacity,
  getWorkplacePopTypeCapacity,
  getWorkplaceEmployedPopSizeByType,
  findBoundPop,
  collectHoldingWorkplaces,
} from './popSelectors'
import { defaultConfig } from '../config/defaultConfig'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { createRealEstateAssetId } from '../types/ids'
import type { MarketResourcePriceState } from '../types/resourceEconomy'
import type { PopGroup } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type {
  StateRegionId,
  ProvinceId,
  HoldingId,
  PopGroupId,
  RealEstateAssetId,
} from '../types/ids'
import type { ResourceKind } from '../types/resource'
import type { PopClass } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'

let popCounter = 0
function withPop(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  size: number,
): WorldState {
  const id = ('pg-slack-' + popCounter++) as PopGroupId
  const pop: PopGroup = {
    id,
    holdingId,
    class: popClass,
    popType: popClass === 'lower' ? 'peasants' : popClass === 'middle' ? 'freeholders' : 'nobles',
    employerId: null,
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
    s = withPop(s, 'hd-0' as HoldingId, 'lower', 100) // peasants
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
    s = withPop(s, 'hd-0' as HoldingId, 'lower', 100) // peasants
    s = withPop(s, 'hd-0' as HoldingId, 'upper', 100) // nobles
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
    s = withPop(s, 'hd-0' as HoldingId, 'lower', 50) // peasants
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
    const s = withPop(state, hd, 'lower', defaultConfig.developRealEstateEmploymentSlackThreshold)
    expect(hasEmploymentSlack(s, defaultConfig, hd)).toBe(true)
  })

  it('閾値未満の失業 POP では false', () => {
    const { state, hd } = setup()
    const s = withPop(
      state,
      hd,
      'lower',
      defaultConfig.developRealEstateEmploymentSlackThreshold - 1,
    )
    expect(hasEmploymentSlack(s, defaultConfig, hd)).toBe(false)
  })

  it('就業済み POP は失業スラックに数えない (Phase 3-4 再有効化)', () => {
    // v0.63 Phase 3-4: farm level 3 を追加して 100 人の農民を全員就業させる。
    //   plains 地形: capacity = 35 × 3 × 1.3 = 136.5 > 100 → 全員就業。
    //   normalizePopEmploymentMut 後は unemployed lower = 0 < threshold(5) → false。
    const { state, hd } = setup()
    let s = withAsset(state, createRealEstateAssetId(100), hd, 'farm', 3)
    s = withPop(s, hd, 'lower', 100)
    normalizePopEmploymentMut(s, defaultConfig, hd)
    expect(hasEmploymentSlack(s, defaultConfig, hd)).toBe(false)
  })
})

// v0.63 Task 3: per-employer capacity selectors
// Helper: holding に RealEstateAsset を追加する (immutable)
function withAsset(
  state: WorldState,
  assetId: RealEstateAssetId,
  holdingId: HoldingId,
  realEstateKind: RealEstateAsset['realEstateKind'],
  level: number,
): WorldState {
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind,
    level,
    createdWeek: 0,
    recipeSlots: {},
  }
  const existing = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  return {
    ...state,
    realEstateAssets: { ...state.realEstateAssets, [assetId]: asset },
    realEstateAssetIndex: {
      ...state.realEstateAssetIndex,
      byHolding: {
        ...state.realEstateAssetIndex.byHolding,
        [holdingId as string]: [...existing, assetId],
      },
    },
  }
}

describe('v0.63 per-employer capacity selectors (Task 3)', () => {
  // セットアップ: withProvince が manor_house(level 1, condition 100) を自動追加する。
  // 追加で farm(level 2) asset を乗せ、improvement 経由 (nobles/laborers 等) と
  // asset 経由 (peasants) の両ブランチを同時に有効化する。
  function setup(): { state: WorldState; holdingId: HoldingId } {
    let s = makeEmptyV016State()
    s = withProvince(s, 'pr-cap' as ProvinceId, {})
    const holdingId = s.provinces['pr-cap' as ProvinceId]!.holdingIds[0]!
    const assetId = createRealEstateAssetId(0)
    s = withAsset(s, assetId, holdingId, 'farm', 2)
    return { state: s, holdingId }
  }

  it('collectHoldingWorkplaces は improvement と asset を返し、key 昇順にソートされる', () => {
    const { state, holdingId } = setup()
    const refs = collectHoldingWorkplaces(state, defaultConfig, holdingId)
    // 少なくとも improvement(manor_house) と asset(farm) の 2 つが返る
    expect(refs.length).toBeGreaterThanOrEqual(2)
    // kind=improvement と kind=asset が両方存在する
    expect(refs.some((r) => r.kind === 'improvement')).toBe(true)
    expect(refs.some((r) => r.kind === 'asset')).toBe(true)
    // workplaceRefKey 昇順にソートされている
    for (let i = 1; i < refs.length; i++) {
      const prev = `${refs[i - 1]!.kind}:${refs[i - 1]!.id as string}`
      const cur = `${refs[i]!.kind}:${refs[i]!.id as string}`
      expect(prev.localeCompare(cur)).toBeLessThanOrEqual(0)
    }
  })

  it('Σ getWorkplacePopTypeCapacity = getHoldingPopTypeCapacity (improvement branch: nobles/laborers)', () => {
    const { state, holdingId } = setup()
    const refs = collectHoldingWorkplaces(state, defaultConfig, holdingId)
    // manor_house level1 condition100: nobles=2/level, laborers=8/level, weight=1
    for (const popType of ['nobles', 'laborers'] as const) {
      const sum = refs.reduce(
        (acc, ref) => acc + getWorkplacePopTypeCapacity(state, defaultConfig, ref, popType),
        0,
      )
      const holdingTotal = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, popType)
      expect(sum).toBeGreaterThan(0)
      expect(sum).toBeCloseTo(holdingTotal, 5)
    }
  })

  it('Σ getWorkplacePopTypeCapacity = getHoldingPopTypeCapacity (asset branch: peasants)', () => {
    const { state, holdingId } = setup()
    const refs = collectHoldingWorkplaces(state, defaultConfig, holdingId)
    // farm level2: peasants=35/level → 70 × overuseMod × weight=1
    const sum = refs.reduce(
      (acc, ref) => acc + getWorkplacePopTypeCapacity(state, defaultConfig, ref, 'peasants'),
      0,
    )
    const holdingTotal = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'peasants')
    expect(sum).toBeGreaterThan(0)
    expect(sum).toBeCloseTo(holdingTotal, 5)
  })

  it('getWorkplaceEmployedPopSizeByType は ref に紐付いた POP の size 合計を返す', () => {
    const { state: base, holdingId } = setup()
    const refs = collectHoldingWorkplaces(base, defaultConfig, holdingId)
    const impRef = refs.find((r) => r.kind === 'improvement')!
    // nobles POP を impRef に紐付けて登録
    const popId = 'pg-t3-nobles' as PopGroupId
    const pop: PopGroup = {
      id: popId,
      holdingId,
      class: 'upper',
      popType: 'nobles',
      employerId: impRef,
      size: 42,
      money: 0,
      needSatisfaction: 50,
      unrest: 0,
      attitudes: {},
    }
    const s = {
      ...base,
      popGroups: { ...base.popGroups, [popId]: pop },
      popIndex: {
        byHolding: {
          ...base.popIndex.byHolding,
          [holdingId]: [...(base.popIndex.byHolding[holdingId] ?? []), popId],
        },
      },
    }
    expect(getWorkplaceEmployedPopSizeByType(s, holdingId, impRef, 'nobles')).toBe(42)
    // 別 popType では 0 を返す
    expect(getWorkplaceEmployedPopSizeByType(s, holdingId, impRef, 'peasants')).toBe(0)
  })

  it('findBoundPop は ref と popType が一致する最初の PopGroupId を返す', () => {
    const { state: base, holdingId } = setup()
    const refs = collectHoldingWorkplaces(base, defaultConfig, holdingId)
    const impRef = refs.find((r) => r.kind === 'improvement')!
    const popId = 'pg-t3-find' as PopGroupId
    const pop: PopGroup = {
      id: popId,
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employerId: impRef,
      size: 10,
      money: 0,
      needSatisfaction: 50,
      unrest: 0,
      attitudes: {},
    }
    const s = {
      ...base,
      popGroups: { ...base.popGroups, [popId]: pop },
      popIndex: {
        byHolding: {
          ...base.popIndex.byHolding,
          [holdingId]: [...(base.popIndex.byHolding[holdingId] ?? []), popId],
        },
      },
    }
    expect(findBoundPop(s, holdingId, impRef, 'laborers')).toBe(popId)
    // 不一致なら undefined
    expect(findBoundPop(s, holdingId, impRef, 'nobles')).toBeUndefined()
  })
})
