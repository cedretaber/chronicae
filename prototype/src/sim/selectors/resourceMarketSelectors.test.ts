import { describe, it, expect } from 'vitest'
import { computeResourcePrice, computeMarketFulfillment } from './resourceMarketSelectors'
import { defaultConfig } from '../config/defaultConfig'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'

// v0.54 市場清算 rewrite (§6.3c.1): imbalance ベース価格 + fulfillment/shortage の純関数テスト。
const cfg = defaultConfig
const BASE_SWING = defaultConfig.marketPriceSwing // 0.75
const FOOD_BASE = RESOURCE_PRICE_DEFINITIONS.grain.basePrice
const GRAIN_UP_SWING = BASE_SWING * RESOURCE_PRICE_DEFINITIONS.grain.priceSwingMultiplier // 2.25

describe('computeResourcePrice — 非対称 imbalance price (§6.3c.1)', () => {
  it('buy == sell: price == basePrice (imbalance 0)', () => {
    expect(computeResourcePrice('grain', 100, 100, cfg)).toBeCloseTo(FOOD_BASE, 6)
  })

  it('supply 過多 (buy < sell): 下落は baseSwing で穏やか (multiplier 不適用)', () => {
    const price = computeResourcePrice('grain', 1000, 1, cfg)
    expect(price).toBeCloseTo(FOOD_BASE * (1 - BASE_SWING), 4)
    expect(price).toBeGreaterThan(0)
  })

  it('supply 不足 (buy > sell): 上昇は multiplier 適用で急騰', () => {
    const price = computeResourcePrice('grain', 1, 1000, cfg)
    expect(price).toBeCloseTo(FOOD_BASE * (1 + GRAIN_UP_SWING), 4)
  })

  it('edge: buy=0, sell=0 → basePrice', () => {
    expect(computeResourcePrice('grain', 0, 0, cfg)).toBeCloseTo(FOOD_BASE, 6)
  })

  it('edge: buy=0, sell>0 → baseSwing での下限価格', () => {
    expect(computeResourcePrice('grain', 50, 0, cfg)).toBeCloseTo(FOOD_BASE * (1 - BASE_SWING), 6)
  })

  it('edge: buy>0, sell=0 → multiplier 適用の上限価格', () => {
    expect(computeResourcePrice('grain', 0, 50, cfg)).toBeCloseTo(
      FOOD_BASE * (1 + GRAIN_UP_SWING),
      6,
    )
  })

  it('price は常に [basePrice×(1-baseSwing), basePrice×(1+upSwing)] に収まる', () => {
    const lo = FOOD_BASE * (1 - BASE_SWING)
    const hi = FOOD_BASE * (1 + GRAIN_UP_SWING)
    for (const [sell, buy] of [
      [1, 1],
      [1, 100],
      [100, 1],
      [0.001, 1000],
      [1000, 0.001],
    ]) {
      const p = computeResourcePrice('grain', sell!, buy!, cfg)
      expect(p).toBeGreaterThanOrEqual(lo - 1e-9)
      expect(p).toBeLessThanOrEqual(hi + 1e-9)
    }
  })

  it('弾力的な品目 (gems) は上昇 swing が小さい', () => {
    const gemsBase = RESOURCE_PRICE_DEFINITIONS.gems.basePrice
    const gemsUpSwing = BASE_SWING * RESOURCE_PRICE_DEFINITIONS.gems.priceSwingMultiplier // 0.3
    const hi = computeResourcePrice('gems', 1, 1000, cfg)
    expect(hi).toBeCloseTo(gemsBase * (1 + gemsUpSwing), 4)
    const lo = computeResourcePrice('gems', 1000, 1, cfg)
    expect(lo).toBeCloseTo(gemsBase * (1 - BASE_SWING), 4)
  })
})

describe('computeMarketFulfillment — shortage / severity (§6.3c.1)', () => {
  it('buy <= 0 → fulfillmentRatio 1, shortage なし', () => {
    const f = computeMarketFulfillment(100, 0, cfg)
    expect(f.fulfillmentRatio).toBe(1)
    expect(f.shortage).toBe(false)
    expect(f.shortageSeverity).toBe(0)
  })

  it('sell >= buy → fulfillmentRatio 1 (clamp 上限)', () => {
    const f = computeMarketFulfillment(200, 100, cfg)
    expect(f.fulfillmentRatio).toBe(1)
    expect(f.shortage).toBe(false)
  })

  it('threshold (0.5) 以上は shortage でない', () => {
    const f = computeMarketFulfillment(60, 100, cfg) // ratio 0.6
    expect(f.fulfillmentRatio).toBeCloseTo(0.6, 6)
    expect(f.shortage).toBe(false)
    expect(f.shortageSeverity).toBe(0)
  })

  it('threshold 未満で shortage、severity は (threshold−ratio)/threshold', () => {
    const f = computeMarketFulfillment(25, 100, cfg) // ratio 0.25, threshold 0.5
    expect(f.fulfillmentRatio).toBeCloseTo(0.25, 6)
    expect(f.shortage).toBe(true)
    expect(f.shortageSeverity).toBeCloseTo((0.5 - 0.25) / 0.5, 6) // 0.5
  })

  it('sell=0, buy>0 → ratio 0, severity 1 (最大)', () => {
    const f = computeMarketFulfillment(0, 100, cfg)
    expect(f.fulfillmentRatio).toBe(0)
    expect(f.shortage).toBe(true)
    expect(f.shortageSeverity).toBe(1)
  })

  it('severity は常に [0, 1]', () => {
    for (const [sell, buy] of [
      [0, 100],
      [10, 100],
      [49, 100],
      [50, 100],
    ]) {
      const f = computeMarketFulfillment(sell!, buy!, cfg)
      expect(f.shortageSeverity).toBeGreaterThanOrEqual(0)
      expect(f.shortageSeverity).toBeLessThanOrEqual(1)
    }
  })
})
