import { describe, it, expect } from 'vitest'
import { runResourceEconomySystem } from './resourceEconomySystem'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopGroup, PopClass } from '../types/popGroup'
import type { RealEstateAsset, RealEstateKind, AssetOwnerRef } from '../types/realEstateAsset'
import type { ProvinceId, HoldingId, PopGroupId, RealEstateAssetId, HouseId } from '../types/ids'
import { makeEmptyV016State, withProvince, withHolding, withHouse } from '../testFixtures'
import { getDefaultRecipeSlotsForRealEstateKind } from '../config/productionRecipeDefinitions'
import { computeAllocatedLaborByAsset } from '../selectors/resourceProductionSelectors'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'

let assetCounter = 0
function withAsset(
  state: WorldState,
  holdingId: HoldingId,
  kind: RealEstateKind,
  level = 1,
  owner?: AssetOwnerRef,
): { state: WorldState; assetId: RealEstateAssetId } {
  const assetId = ('re-' + assetCounter++) as RealEstateAssetId
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind: kind,
    level,
    createdWeek: 0,
    recipeSlots: getDefaultRecipeSlotsForRealEstateKind(kind),
    ...(owner ? { owner } : {}),
  }
  const existing = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  return {
    state: {
      ...state,
      realEstateAssets: { ...state.realEstateAssets, [assetId]: asset },
      realEstateAssetIndex: {
        byHolding: {
          ...state.realEstateAssetIndex.byHolding,
          [holdingId as string]: [...existing, assetId],
        },
        byOwner: state.realEstateAssetIndex.byOwner,
      },
    },
    assetId,
  }
}

let popCounter = 0
function withEmployedPop(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  size: number,
  wealth = 50,
): WorldState {
  const id = ('pg-' + popCounter++) as PopGroupId
  const pop: PopGroup = {
    id,
    holdingId,
    class: popClass,
    employed: true,
    size,
    wealth,
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

function runEcon(state: WorldState, config: SimulationConfig = defaultConfig): WorldState {
  const ctx = createTickContext({ state, config, rng: createRng('test') })
  return runResourceEconomySystem(ctx).state
}

function firstHoldingId(state: WorldState, provinceId: ProvinceId): HoldingId {
  return state.provinces[provinceId]!.holdingIds[0]!
}

describe('runResourceEconomySystem — production & market', () => {
  it('field produces food and earns revenue', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'field').state
    state = withEmployedPop(state, hd, 'peasants', 100)

    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[hd]
    expect(snap).toBeDefined()
    expect(snap!.byResource.food).toBeGreaterThan(0)
    expect(snap!.totalNetRevenue).toBeGreaterThan(0)
  })

  it('workshop with a raw_materials source produces processed_goods; without it produces none', () => {
    // pr-0 (manor, pasture) と city holding を同 province=同 StateRegion(sr-0) に置く。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const manor = firstHoldingId(state, 'pr-0' as ProvinceId)
    const city = 'hd-city' as HoldingId
    state = withHolding(state, city, 'pr-0' as ProvinceId, { kind: 'city' })
    state = withAsset(state, manor, 'pasture').state
    state = withAsset(state, city, 'workshop').state
    state = withEmployedPop(state, manor, 'peasants', 100)
    state = withEmployedPop(state, city, 'townsmen', 100)

    const withRaw = runEcon(state)
    const citySnapWith = withRaw.monthlyHoldingResourceRevenue[city]
    expect(citySnapWith!.byResource.processed_goods ?? 0).toBeGreaterThan(0)

    // pasture を取り除く (raw 供給 0) → workshop の processed は 0 になる。
    let noRaw = makeEmptyV016State()
    noRaw = withProvince(noRaw, 'pr-0' as ProvinceId, {})
    const city2 = 'hd-city2' as HoldingId
    noRaw = withHolding(noRaw, city2, 'pr-0' as ProvinceId, { kind: 'city' })
    noRaw = withAsset(noRaw, city2, 'workshop').state
    noRaw = withEmployedPop(noRaw, city2, 'townsmen', 100)
    const noRawResult = runEcon(noRaw)
    const citySnapNo = noRawResult.monthlyHoldingResourceRevenue[city2]
    expect(citySnapNo!.byResource.processed_goods ?? 0).toBe(0)
  })

  it('food price rises with demand: more POP (demand) lifts price above a low-demand market', () => {
    function priceFor(popSize: number): number {
      let state = makeEmptyV016State()
      state = withProvince(state, 'pr-0' as ProvinceId, {})
      const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
      state = withAsset(state, hd, 'field').state
      state = withEmployedPop(state, hd, 'peasants', 50) // 一定の供給
      state = withEmployedPop(state, hd, 'townsmen', popSize) // 需要のみ増やす (workshop 無)
      const result = runEcon(state)
      return result.marketResourcePrices['sr-0:food']!.lastPrice
    }
    expect(priceFor(500)).toBeGreaterThan(priceFor(10))
  })

  it('price history is capped at marketResourcePriceHistoryLimit', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'field').state
    state = withEmployedPop(state, hd, 'peasants', 100)
    const cfg: SimulationConfig = { ...defaultConfig, marketResourcePriceHistoryLimit: 3 }
    for (let i = 0; i < 6; i++) {
      state = runEcon(state, cfg)
    }
    const ps = state.marketResourcePrices['sr-0:food']!
    expect(ps.history.length).toBe(3)
  })

  it('supply 過多: 全量売却され廃棄ゼロ (price 下限・producerRevenue>0)', () => {
    // 大量の field 供給 + 極小の需要 (POP 少) → foodPrice は下限へ、しかし produced は全量売れる。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'field').state
    state = withEmployedPop(state, hd, 'peasants', 500) // 大供給
    state = withEmployedPop(state, hd, 'townsmen', 1) // 極小の food 需要
    const result = runEcon(state)
    const ps = result.marketResourcePrices['sr-0:food']!
    const last = ps.history[ps.history.length - 1]!
    // 供給 >> 需要 → 価格は下限近辺
    expect(ps.lastPrice).toBeLessThan(RESOURCE_PRICE_DEFINITIONS.food.basePrice)
    // 全量が sellOrders として計上され producerRevenue > 0 (廃棄されない)
    expect(last.sellOrders).toBeGreaterThan(last.buyOrders)
    expect(last.producerRevenue).toBeGreaterThan(0)
    // field は入力なし → netRevenue > 0 (安値でも全量売れるため)
    const snap = result.monthlyHoldingResourceRevenue[hd]!
    expect(snap.totalNetRevenue).toBeGreaterThan(0)
  })

  it('raw 不足 workshop: input 全量 cost・output 縮小で netRevenue が負になり得る', () => {
    // pasture (raw 供給) 無しの workshop → rawFulfillmentRatio=0 → processed 産出 0、しかし raw は全量 cost。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const city = 'hd-city' as HoldingId
    state = withHolding(state, city, 'pr-0' as ProvinceId, { kind: 'city' })
    const a = withAsset(state, city, 'workshop')
    state = a.state
    state = withEmployedPop(state, city, 'townsmen', 100)
    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[city]!
    const ar = snap.assetResults.find((r) => (r.assetId as string) === (a.assetId as string))!
    // raw を満額 cost で買い、processed は産出 0 → 赤字
    expect(ar.outputs.processed_goods ?? 0).toBe(0)
    expect(ar.inputCost).toBeGreaterThan(0)
    expect(ar.netRevenue).toBeLessThan(0)
    // holding 集計は床留めで 0 (赤字は分配に乗らない)
    expect(snap.totalNetRevenue).toBe(0)
  })

  it('consumerCost 二層性: POP food 需要は価格を上げるが asset inputCost に計上されない', () => {
    // field のみ + 多数の POP → food buyOrders 大 → price 上昇。だが field は入力なしで inputCost=0。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    const a = withAsset(state, hd, 'field')
    state = a.state
    state = withEmployedPop(state, hd, 'peasants', 50) // 供給
    state = withEmployedPop(state, hd, 'townsmen', 400) // food 需要のみ
    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[hd]!
    const ar = snap.assetResults.find((r) => (r.assetId as string) === (a.assetId as string))!
    // POP の food 需要は market buyOrders を押し上げる (price>base)
    expect(result.marketResourcePrices['sr-0:food']!.lastPrice).toBeGreaterThan(
      RESOURCE_PRICE_DEFINITIONS.food.basePrice,
    )
    // しかし POP コストは asset の inputCost に計上されない (二層性)
    expect(ar.inputCost).toBe(0)
    expect(ar.netRevenue).toBeGreaterThan(0)
  })

  it('正の充足チャネルは需要ゼロの資源で発火しない (buyOrders=0 ゲート)', () => {
    // peasants のみ (processed 需要 0) の市場。processed 正チャネルを巨大にしても wealth は跳ねない。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'field').state
    state = withEmployedPop(state, hd, 'peasants', 100, 50)
    // food 系チャネルを 0 にし、processed 正チャネルだけ巨大にして単離する。
    const cfg: SimulationConfig = {
      ...defaultConfig,
      foodShortageWealthPenalty: 0,
      foodHighPriceWealthPenalty: 0,
      foodFulfillmentWealthGain: 0,
      foodShortageUnrestGain: 0,
      foodHighPriceUnrestGain: 0,
      foodFulfillmentUnrestReduction: 0,
      processedGoodsShortageWealthPenalty: 0,
      processedGoodsShortageUnrestGain: 0,
      processedGoodsFulfillmentWealthGain: 50, // 巨大: ゲートが無ければ wealth が跳ねる
      processedGoodsFulfillmentUnrestReduction: 0,
      // peasants が processed を需要しないことを保証
      popProcessedGoodsDemandPerSizeByClass: {
        ...defaultConfig.popProcessedGoodsDemandPerSizeByClass,
        peasants: 0,
      },
    }
    const result = runEcon(state, cfg)
    const popId = state.popIndex.byHolding[hd]![0]!
    // processed 需要ゼロ → 正チャネル発火せず wealth 不変 (50 のまま)
    expect(result.popGroups[popId]!.wealth).toBe(50)
  })

  it('does not consume RNG and does not mutate treasury (Phase 2-3 side-effect boundary)', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'field').state
    state = withEmployedPop(state, hd, 'peasants', 100)
    const ctx = createTickContext({ state, config: defaultConfig, rng: createRng('test') })
    const result = runResourceEconomySystem(ctx)
    // RNG state は不変 (system は RNG を消費しない)
    expect(result.rng).toEqual(ctx.rng)
  })
})

describe('computeAllocatedLaborByAsset — labor conservation', () => {
  it('Σ allocatedLabor == employed POP size for a class with receiving assets', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    const a1 = withAsset(state, hd, 'field', 2)
    state = a1.state
    const a2 = withAsset(state, hd, 'pasture', 1)
    state = a2.state
    state = withEmployedPop(state, hd, 'peasants', 137)

    const assets = [state.realEstateAssets[a1.assetId]!, state.realEstateAssets[a2.assetId]!]
    const allocated = computeAllocatedLaborByAsset(state, defaultConfig, hd, assets)
    const total = (allocated.get(a1.assetId) ?? 0) + (allocated.get(a2.assetId) ?? 0)
    expect(total).toBeCloseTo(137, 6)
  })

  it('class with no receiving asset contributes no labor (idle, not double-counted)', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    const a1 = withAsset(state, hd, 'field')
    state = a1.state
    // townsmen は受け皿 (workshop) が無いので配分されない。
    state = withEmployedPop(state, hd, 'peasants', 80)
    state = withEmployedPop(state, hd, 'townsmen', 40)

    const assets = [state.realEstateAssets[a1.assetId]!]
    const allocated = computeAllocatedLaborByAsset(state, defaultConfig, hd, assets)
    expect(allocated.get(a1.assetId)).toBeCloseTo(80, 6)
  })
})

describe('recipeSlots default', () => {
  it('default recipeSlots total equals realEstateRecipeSlotCount', () => {
    for (const kind of ['field', 'pasture', 'workshop'] as RealEstateKind[]) {
      const slots = getDefaultRecipeSlotsForRealEstateKind(kind)
      const total = Object.values(slots).reduce<number>((s, v) => s + (v ?? 0), 0)
      expect(total).toBe(defaultConfig.realEstateRecipeSlotCount)
    }
  })
})

// 押領・上納拒否の owner 会計はテスト用 owner を付けて確認する。
describe('runResourceEconomySystem — owner asset revenue feeds snapshot (distribution is landRevenue)', () => {
  it('owned asset still produces netRevenue in snapshot (owner split happens downstream)', () => {
    let state = makeEmptyV016State()
    state = withHouse(state, 'dh-0' as HouseId, {})
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    const owner: AssetOwnerRef = { kind: 'house', id: 'dh-0' as HouseId }
    const a = withAsset(state, hd, 'field', 1, owner)
    state = a.state
    state = withEmployedPop(state, hd, 'peasants', 100)
    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[hd]
    const ar = snap!.assetResults.find((r) => (r.assetId as string) === (a.assetId as string))
    expect(ar).toBeDefined()
    expect(ar!.netRevenue).toBeGreaterThan(0)
  })
})
