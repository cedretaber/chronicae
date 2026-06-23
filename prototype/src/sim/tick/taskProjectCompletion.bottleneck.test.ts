import { describe, it, expect } from 'vitest'
import { selectProductivityImprovementForBottleneck } from './taskProjectCompletion'
import { getHoldingProducedResourcesByAssetKind } from '../selectors/resourceProductionSelectors'
import { getResourceShortageSeverity } from '../selectors/resourceRevenueSelectors'
import { IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS } from '../config/resourceEconomyDefinitions'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import type { MarketResourcePriceState } from '../types/resourceEconomy'
import { createProvinceId, createRealEstateAssetId } from '../types/ids'
import type { ProductionRecipeId, HoldingId, StateRegionId } from '../types/ids'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { ResourceKind } from '../types/resource'
import type { WorldState } from '../types/world'

const PA = createProvinceId('p', 0)
const GRAIN_FIELD = 'grain_field' as ProductionRecipeId
const SR0 = 'sr-0' as StateRegionId

// shortageSeverity を持つ最小の market price state を作る。
function mkMarket(
  stateId: StateRegionId,
  resource: ResourceKind,
  severity: number,
): MarketResourcePriceState {
  return {
    marketKey: stateId,
    resource,
    lastPrice: 1,
    smoothedPrice: 1,
    history: [
      {
        week: 0,
        price: 1,
        sellOrders: 1,
        buyOrders: 1,
        producerRevenue: 1,
        consumerCost: 1,
        fulfillmentRatio: 1 - severity,
        shortage: severity > 0,
        shortageSeverity: severity,
      },
    ],
  }
}

// farm asset (grain_field) を 1 つ持つ manor holding の state を組む。
function setupFarmHolding(grainSeverity: number): { state: WorldState; holdingId: HoldingId } {
  let s = makeEmptyV016State()
  s = withProvince(s, PA)
  const holdingId = s.provinces[PA]!.holdingIds[0]!
  const assetId = createRealEstateAssetId(0)
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind: 'farm',
    level: 1,
    createdWeek: 0,
    recipeSlots: { [GRAIN_FIELD]: 10 },
  }
  const state: WorldState = {
    ...s,
    realEstateAssets: { [assetId]: asset },
    realEstateAssetIndex: {
      ...s.realEstateAssetIndex,
      byHolding: { ...s.realEstateAssetIndex.byHolding, [holdingId as string]: [assetId] },
    },
    marketResourcePrices: {
      ...s.marketResourcePrices,
      [marketResourcePriceKey(SR0, 'grain')]: mkMarket(SR0, 'grain', grainSeverity),
    },
  }
  return { state, holdingId }
}

describe('getHoldingProducedResourcesByAssetKind (v0.59 追補③)', () => {
  it('farm asset の grain_field → { farm: {grain} }', () => {
    const { state, holdingId } = setupFarmHolding(0)
    const map = getHoldingProducedResourcesByAssetKind(state, holdingId)
    expect(map.get('farm')).toEqual(new Set<ResourceKind>(['grain']))
  })
  it('asset 無し holding → 空 Map', () => {
    const s = withProvince(makeEmptyV016State(), PA)
    const hid = s.provinces[PA]!.holdingIds[0]!
    expect(getHoldingProducedResourcesByAssetKind(s, hid).size).toBe(0)
  })
})

describe('getResourceShortageSeverity (v0.59 追補③)', () => {
  it('market history の shortageSeverity を返す', () => {
    const { state } = setupFarmHolding(0.5)
    expect(getResourceShortageSeverity(state, SR0, 'grain')).toBeCloseTo(0.5)
  })
  it('market 不在は 0', () => {
    const { state } = setupFarmHolding(0.5)
    expect(getResourceShortageSeverity(state, SR0, 'fish')).toBe(0)
  })
})

describe('IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS (v0.59 追補③ 逆引き)', () => {
  it('irrigation は farm を boost', () => {
    expect(IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS.irrigation_infrastructure).toEqual(['farm'])
  })
  it('transport は複数 realEstateKind を boost (farm を含む)', () => {
    expect(IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS.transport_infrastructure).toContain('farm')
  })
})

describe('selectProductivityImprovementForBottleneck (v0.59 追補③)', () => {
  it('grain 品薄 (≥0.2) の farm holding → irrigation_infrastructure を返す', () => {
    const { state, holdingId } = setupFarmHolding(0.5)
    expect(selectProductivityImprovementForBottleneck(state, defaultConfig, holdingId)).toBe(
      'irrigation_infrastructure',
    )
  })

  it('grain が品薄でない (severity 0) → undefined', () => {
    const { state, holdingId } = setupFarmHolding(0)
    expect(
      selectProductivityImprovementForBottleneck(state, defaultConfig, holdingId),
    ).toBeUndefined()
  })

  it('severity が閾値 (0.2) 未満 → undefined', () => {
    const { state, holdingId } = setupFarmHolding(0.1)
    expect(
      selectProductivityImprovementForBottleneck(state, defaultConfig, holdingId),
    ).toBeUndefined()
  })

  it('farm asset 無し holding → undefined', () => {
    const s = withProvince(makeEmptyV016State(), PA)
    const hid = s.provinces[PA]!.holdingIds[0]!
    const state: WorldState = {
      ...s,
      marketResourcePrices: {
        ...s.marketResourcePrices,
        [marketResourcePriceKey(SR0, 'grain')]: mkMarket(SR0, 'grain', 0.9),
      },
    }
    expect(selectProductivityImprovementForBottleneck(state, defaultConfig, hid)).toBeUndefined()
  })

  it('灌漑が max level (3) 到達済みでも transport_infrastructure へフォールバック (汎用性)', () => {
    const { state, holdingId } = setupFarmHolding(0.5)
    // 灌漑を max level の improvement として登録 → canBuildHoldingImprovement(irrigation)=false。
    const impId = 'imp-0' as never
    const withMaxedIrrigation: WorldState = {
      ...state,
      holdingImprovements: {
        ...state.holdingImprovements,
        [impId]: {
          id: impId,
          holdingId,
          kind: 'irrigation_infrastructure',
          level: 3,
          condition: 100,
          createdWeek: 0,
        },
      },
      holdingImprovementIndex: {
        ...state.holdingImprovementIndex,
        byHolding: {
          ...state.holdingImprovementIndex.byHolding,
          [holdingId as string]: [impId],
        },
      },
    }
    expect(
      selectProductivityImprovementForBottleneck(withMaxedIrrigation, defaultConfig, holdingId),
    ).toBe('transport_infrastructure')
  })
})
