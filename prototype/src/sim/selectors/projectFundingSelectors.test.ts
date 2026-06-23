import { describe, expect, it } from 'vitest'
import { getPopPredictedLifeCost, getPopContributableSurplus } from './projectFundingSelectors'
import { defaultConfig } from '../config/defaultConfig'
import type { PopGroup } from '../types/popGroup'
import { createPopGroupId, createHoldingId } from '../types/ids'

function makePop(money: number, size = 100): PopGroup {
  return {
    id: createPopGroupId(0),
    holdingId: createHoldingId(0),
    class: 'lower',
    popType: 'peasants',
    employed: true,
    size,
    money,
    needSatisfaction: 50,
    unrest: 0,
    attitudes: {},
  }
}

// 全資源 price=1 の単純 lookup。lifeCost = Σ buyOrders。
const price1 = () => 1

describe('v0.60 POP 拠出余剰', () => {
  it('lifeCost は正（peasants は staple/protein 等 essential need を持つ）', () => {
    const cost = getPopPredictedLifeCost(makePop(0), defaultConfig, price1)
    expect(cost).toBeGreaterThan(0)
  })

  it('飢えた POP（money < lifeCost×horizon）は surplus 0', () => {
    const cost = getPopPredictedLifeCost(makePop(0), defaultConfig, price1)
    const poor = makePop(cost) // horizon(3)×cost に満たない
    expect(getPopContributableSurplus(poor, defaultConfig, price1)).toBe(0)
  })

  it('余剰のある POP は (money − lifeCost×horizon) を返す', () => {
    const cost = getPopPredictedLifeCost(makePop(0), defaultConfig, price1)
    const rich = makePop(cost * defaultConfig.popContributionHorizonMonths + 500)
    expect(getPopContributableSurplus(rich, defaultConfig, price1)).toBeCloseTo(500, 6)
  })
})
