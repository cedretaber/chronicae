import { describe, it, expect } from 'vitest'
import { selectProductivityImprovementForBottleneck } from '../selectors/productivityBottleneckSelectors'
import { getHoldingProducedResourcesByAssetKind } from '../selectors/resourceProductionSelectors'
import {
  getResourceShortageSeverity,
  getResourceBottleneckSeverity,
} from '../selectors/resourceRevenueSelectors'
import { IMPROVEMENT_BOOSTED_REAL_ESTATE_KINDS } from '../config/resourceEconomyDefinitions'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import type { MarketResourcePriceState } from '../types/resourceEconomy'
import { createProvinceId, createRealEstateAssetId, createPopGroupId } from '../types/ids'
import type { ProductionRecipeId, HoldingId, StateRegionId } from '../types/ids'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { PopGroup } from '../types/popGroup'
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

// 食料は市場が自己均衡し shortageSeverity≈0 になるため、人口圧 (pressure) シグナルで検出する。
//   pop size 100 + 食料 CC を floor(50) に張り付かせて pressure=2.0 を作る (grain 市場 severity は 0)。
function mkPop(
  id: ReturnType<typeof createPopGroupId>,
  holdingId: HoldingId,
  size: number,
): PopGroup {
  return {
    id,
    holdingId,
    class: 'lower',
    popType: 'peasants',
    employed: true,
    size,
    money: 0,
    needSatisfaction: 50,
    unrest: 10,
    attitudes: {},
  }
}

describe('食料 pressure シグナル (v0.59 追補③: 市場が見えない食料ボトルネックの検出)', () => {
  function setupFoodBound(): { state: WorldState; holdingId: HoldingId } {
    const base = setupFarmHolding(0) // grain 市場 severity = 0
    const popId = createPopGroupId(900)
    const state: WorldState = {
      ...base.state,
      popGroups: {
        ...base.state.popGroups,
        [popId]: mkPop(popId, base.holdingId, 100),
      },
      popIndex: {
        ...base.state.popIndex,
        byHolding: { ...base.state.popIndex.byHolding, [base.holdingId as string]: [popId] },
      },
    }
    return { state, holdingId: base.holdingId }
  }

  it('grain 市場 severity=0 でも pressure≥0.9 なら bottleneck severity は pressure を採用', () => {
    const { state } = setupFoodBound()
    // pop 100 / 食料CC floor 50 → pressure clamp 2.0。market severity 0 を上回る。
    expect(getResourceShortageSeverity(state, SR0, 'grain')).toBe(0)
    expect(
      getResourceBottleneckSeverity(state, defaultConfig, PA, SR0, 'grain'),
    ).toBeGreaterThanOrEqual(defaultConfig.foodBottleneckPressureThreshold)
  })

  it('食料束縛 (pressure 高・市場均衡) の farm holding → irrigation を選ぶ', () => {
    const { state, holdingId } = setupFoodBound()
    expect(selectProductivityImprovementForBottleneck(state, defaultConfig, holdingId)).toBe(
      'irrigation_infrastructure',
    )
  })
})
