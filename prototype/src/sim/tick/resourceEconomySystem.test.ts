import { describe, it, expect } from 'vitest'
import { runResourceEconomySystem } from './resourceEconomySystem'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopGroup, PopClass, PopType } from '../types/popGroup'

// stratum→代表 PopType (テスト用。getPopStratum(rep)===stratum を満たす)。
const REP_POP_TYPE: Record<PopClass, PopType> = {
  lower: 'peasants',
  middle: 'freeholders',
  upper: 'nobles',
}
import type { RealEstateAsset, RealEstateKind, AssetOwnerRef } from '../types/realEstateAsset'
import type {
  ProvinceId,
  HoldingId,
  PopGroupId,
  RealEstateAssetId,
  HouseId,
  ProductionRecipeId,
  CrisisId,
} from '../types/ids'
import type { Crisis } from '../types/crisis'
import { makeEmptyV016State, withProvince, withHolding, withHouse } from '../testFixtures'
import { getDefaultRecipeSlotsForRealEstateKind } from '../config/productionRecipeDefinitions'
import { computeAllocatedLaborByAsset } from '../selectors/resourceProductionSelectors'
import { computePopNeedDemand } from '../selectors/resourceMarketSelectors'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'

// grain 専業の recipeSlots 上書き (供給/需要を単一 resource に絞るテスト用)。
const GRAIN_ONLY: Partial<Record<ProductionRecipeId, number>> = {
  ['grain_field' as ProductionRecipeId]: 20,
}

let assetCounter = 0
function withAsset(
  state: WorldState,
  holdingId: HoldingId,
  kind: RealEstateKind,
  level = 1,
  owner?: AssetOwnerRef,
  recipeSlots?: Partial<Record<ProductionRecipeId, number>>,
): { state: WorldState; assetId: RealEstateAssetId } {
  const assetId = ('re-' + assetCounter++) as RealEstateAssetId
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind: kind,
    level,
    createdWeek: 0,
    recipeSlots: recipeSlots ?? getDefaultRecipeSlotsForRealEstateKind(kind),
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
  needSatisfaction = 50, // v0.58: 旧 wealth 引数を needSatisfaction(welfare) へ転用。
  employed = true,
  popType?: PopType, // v0.57: 施設固有の職能を雇用したい場合に上書き (省略時は stratum 代表)。
  money = 0,
): WorldState {
  const id = ('pg-' + popCounter++) as PopGroupId
  const pop: PopGroup = {
    id,
    holdingId,
    class: popClass,
    popType: popType ?? REP_POP_TYPE[popClass],
    employed,
    size,
    money,
    needSatisfaction,
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

let crisisCounter = 0
function withDrought(state: WorldState, holdingId: HoldingId, severity: number): WorldState {
  const id = ('cr-' + crisisCounter++) as CrisisId
  const crisis: Crisis = {
    id,
    kind: 'drought',
    holdingId,
    severity,
    createdWeek: 0,
    deadlineWeek: 32,
    status: 'active',
    reasonIds: [],
  }
  return { ...state, crises: { ...state.crises, [id]: crisis } }
}

function runEcon(state: WorldState, config: SimulationConfig = defaultConfig): WorldState {
  const ctx = createTickContext({ state, config, rng: createRng('test') })
  return runResourceEconomySystem(ctx).state
}

function firstHoldingId(state: WorldState, provinceId: ProvinceId): HoldingId {
  return state.provinces[provinceId]!.holdingIds[0]!
}

describe('runResourceEconomySystem — production & market', () => {
  it('farm produces grain and earns revenue', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'farm').state
    state = withEmployedPop(state, hd, 'lower', 100)

    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[hd]
    expect(snap).toBeDefined()
    expect(snap!.byResource.grain).toBeGreaterThan(0)
    expect(snap!.totalNetRevenue).toBeGreaterThan(0)
  })

  it('v0.58: 賃金 carve で雇用 POP の money が増え、carve==mint (minted 合計 == wageShare)', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'farm').state
    state = withEmployedPop(state, hd, 'lower', 100) // 生産者 (peasants), money 初期 0
    // 施設専用 popType (soldiers) を雇用。manor は manor_house を自動生成し soldiers slot を持つため、
    //   v0.58 では施設俸給がこの soldiers POP **本人**へ mint される (生産者には mint しない)。
    state = withEmployedPop(state, hd, 'lower', 30, 50, true, 'soldiers')

    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[hd]!
    const ar = snap.assetResults[0]!
    expect(ar.wageShare).toBeGreaterThan(0)
    // wageShare は生産賃金 (max(0, netRevenue) × wageRate) に加え施設労働者の俸給を含む。
    const prodWageOnly = Math.max(0, ar.netRevenue) * defaultConfig.wageShareOfNetRevenue
    expect(ar.wageShare).toBeGreaterThan(prodWageOnly) // 施設俸給分が上乗せされている
    // v0.58: 施設専用 popType (soldiers) 本人に施設俸給が mint されている (生産 asset に登場しないため
    //   従来は収入ゼロだったが、同 stratum の生産 per-capita 相当が本人へ届く)。
    const soldierPop = Object.values(result.popGroups).find(
      (p) => p.holdingId === hd && p.popType === 'soldiers',
    )!
    expect(soldierPop.money).toBeGreaterThan(0)
    // carve==mint: この holding の全 POP に増えた money の合計が wageShare と一致 (初期 money=0)。
    //   生産賃金 + 施設俸給の総 mint == 総 wageShare (asset 1 つなので全 supplement がこの asset に按分)。
    const mintedTotal = Object.values(result.popGroups)
      .filter((p) => p.holdingId === hd)
      .reduce((a, p) => a + p.money, 0)
    expect(mintedTotal).toBeCloseTo(ar.wageShare, 6)
  })

  it('v0.58: wageShareOfNetRevenue=0 では money が mint されず wageShare=0', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'farm').state
    state = withEmployedPop(state, hd, 'lower', 100)

    const result = runEcon(state, { ...defaultConfig, wageShareOfNetRevenue: 0 })
    const snap = result.monthlyHoldingResourceRevenue[hd]!
    expect(snap.assetResults[0]!.wageShare).toBe(0)
    const mintedTotal = Object.values(result.popGroups)
      .filter((p) => p.holdingId === hd)
      .reduce((a, p) => a + p.money, 0)
    expect(mintedTotal).toBe(0)
  })

  it('干魃 Crisis (v0.55 §B): active な holding の食料 (grain) 産出を severity 倍率で減衰させる', () => {
    function grainOutput(withCrisis: boolean): number {
      let state = makeEmptyV016State()
      state = withProvince(state, 'pr-0' as ProvinceId, {})
      const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
      state = withAsset(state, hd, 'farm', 1, undefined, GRAIN_ONLY).state
      state = withEmployedPop(state, hd, 'lower', 100)
      if (withCrisis) state = withDrought(state, hd, 30)
      const result = runEcon(state)
      return result.monthlyHoldingResourceRevenue[hd]!.byResource.grain ?? 0
    }
    const base = grainOutput(false)
    const drought = grainOutput(true)
    // severity 30 → 倍率 = max(floor 0.3, 1 − 1.0 × 0.30) = 0.70。
    const expectedScale = 1 - defaultConfig.droughtFoodOutputPenaltyRate * (30 / 100)
    expect(base).toBeGreaterThan(0)
    expect(drought).toBeCloseTo(base * expectedScale, 5)
  })

  it('干魃 Crisis: 産出減衰は floor で下げ止まる (severity 100 でも floor 倍は残る)', () => {
    function grainOutput(severity: number | null): number {
      let state = makeEmptyV016State()
      state = withProvince(state, 'pr-0' as ProvinceId, {})
      const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
      state = withAsset(state, hd, 'farm', 1, undefined, GRAIN_ONLY).state
      state = withEmployedPop(state, hd, 'lower', 100)
      if (severity !== null) state = withDrought(state, hd, severity)
      return runEcon(state).monthlyHoldingResourceRevenue[hd]!.byResource.grain ?? 0
    }
    const base = grainOutput(null)
    const severe = grainOutput(100)
    expect(severe).toBeCloseTo(base * defaultConfig.droughtFoodOutputFloor, 5)
  })

  it('workshop with a grain source brews more beer; without it falls to the shortage floor', () => {
    // pr-0 (manor, farm=grain) と city holding を同 province=同 StateRegion(sr-0) に置く。
    //   workshop の既定 recipe は tool_workshop + workshop_brewery。grain があれば beer を多く醸造できる。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const manor = firstHoldingId(state, 'pr-0' as ProvinceId)
    const city = 'hd-city' as HoldingId
    state = withHolding(state, city, 'pr-0' as ProvinceId, { kind: 'city' })
    state = withAsset(state, manor, 'farm').state
    state = withAsset(state, city, 'workshop').state
    state = withEmployedPop(state, manor, 'lower', 100)
    // v0.57: workshop の主要生産者は職人 (artisans)。
    state = withEmployedPop(state, city, 'lower', 100, 50, true, 'artisans')

    const withRaw = runEcon(state)
    const citySnapWith = withRaw.monthlyHoldingResourceRevenue[city]
    const beerWith = citySnapWith!.byResource.beer ?? 0
    expect(beerWith).toBeGreaterThan(0)

    // farm を取り除く (grain 供給 0) → §12.4 改訂: 完全停止せず floor (inputShortageOutputFloor) 倍まで縮小。
    let noRaw = makeEmptyV016State()
    noRaw = withProvince(noRaw, 'pr-0' as ProvinceId, {})
    const city2 = 'hd-city2' as HoldingId
    noRaw = withHolding(noRaw, city2, 'pr-0' as ProvinceId, { kind: 'city' })
    noRaw = withAsset(noRaw, city2, 'workshop').state
    noRaw = withEmployedPop(noRaw, city2, 'lower', 100, 50, true, 'artisans')
    const noRawResult = runEcon(noRaw)
    const citySnapNo = noRawResult.monthlyHoldingResourceRevenue[city2]
    const beerNo = citySnapNo!.byResource.beer ?? 0
    // 供給ゼロでも floor 倍は生産する (>0)。ただし grain がある方より少ない。
    expect(beerNo).toBeGreaterThan(0)
    expect(beerNo).toBeLessThan(beerWith)
  })

  it('food price rises with demand: more POP (demand) lifts price above a low-demand market', () => {
    function priceFor(popSize: number): number {
      let state = makeEmptyV016State()
      state = withProvince(state, 'pr-0' as ProvinceId, {})
      const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
      state = withAsset(state, hd, 'farm', 1, undefined, GRAIN_ONLY).state
      // 供給は lower POP のみ (一定)。需要側は未就業 middle POP にする — farm は middle も雇用するため、
      //   就業させると grain を生産してしまい「需要のみ増やす」意図が崩れる (v0.55 grain 出力2倍で顕在化)。
      state = withEmployedPop(state, hd, 'lower', 10) // 一定の供給
      // v0.58: 需要は money 制約されるため、afford=1 となる潤沢な money を与えて需要を size に比例させる。
      state = withEmployedPop(state, hd, 'middle', popSize, 50, false, undefined, popSize * 1000) // 未就業=需要のみ
      const result = runEcon(state)
      return result.marketResourcePrices['sr-0:grain']!.lastPrice
    }
    expect(priceFor(500)).toBeGreaterThan(priceFor(10))
  })

  it('price history is capped at marketResourcePriceHistoryLimit', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'farm').state
    state = withEmployedPop(state, hd, 'lower', 100)
    const cfg: SimulationConfig = { ...defaultConfig, marketResourcePriceHistoryLimit: 3 }
    for (let i = 0; i < 6; i++) {
      state = runEcon(state, cfg)
    }
    const ps = state.marketResourcePrices['sr-0:grain']!
    expect(ps.history.length).toBe(3)
  })

  it('supply 過多: 全量売却され廃棄ゼロ (price 下限・producerRevenue>0)', () => {
    // 大量の field 供給 + 極小の需要 (POP 少) → foodPrice は下限へ、しかし produced は全量売れる。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'farm', 1, undefined, GRAIN_ONLY).state
    state = withEmployedPop(state, hd, 'lower', 500) // 大供給
    state = withEmployedPop(state, hd, 'middle', 1) // 極小の food 需要
    const result = runEcon(state)
    const ps = result.marketResourcePrices['sr-0:grain']!
    const last = ps.history[ps.history.length - 1]!
    // 供給 >> 需要 → 価格は下限近辺
    expect(ps.lastPrice).toBeLessThan(RESOURCE_PRICE_DEFINITIONS.grain.basePrice)
    // 全量が sellOrders として計上され producerRevenue > 0 (廃棄されない)
    expect(last.sellOrders).toBeGreaterThan(last.buyOrders)
    expect(last.producerRevenue).toBeGreaterThan(0)
    // field は入力なし → netRevenue > 0 (安値でも全量売れるため)
    const snap = result.monthlyHoldingResourceRevenue[hd]!
    expect(snap.totalNetRevenue).toBeGreaterThan(0)
  })

  it('input 供給ゼロ workshop: §12.4/§12.5 改訂 — floor 倍は生産し input を market price で購入する', () => {
    // input 供給 (grain/iron_ore/timber) 無しの workshop → inputFulfillmentScale=0、
    //   inputShortageModifier = floor (= inputShortageOutputFloor) へ。完全停止せず floor 倍を生産し、
    //   希少 input を market price (天井) で購入扱い → 実コスト>0・低利益/赤字となる。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const city = 'hd-city' as HoldingId
    state = withHolding(state, city, 'pr-0' as ProvinceId, { kind: 'city' })
    const a = withAsset(state, city, 'workshop')
    state = a.state
    // v0.57: workshop の主要生産者は職人 (artisans)。
    state = withEmployedPop(state, city, 'lower', 100, 50, true, 'artisans')
    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[city]!
    const ar = snap.assetResults.find((r) => (r.assetId as string) === (a.assetId as string))!
    // floor: 入力ゼロでも floor 倍は生産する (>0) / input は market price で課金される (>0)。
    expect(ar.outputs.beer ?? 0).toBeGreaterThan(0)
    expect(ar.outputs.tools ?? 0).toBeGreaterThan(0)
    expect(ar.inputCost).toBeGreaterThan(0)
  })

  it('consumerCost 二層性: POP food 需要は価格を上げるが asset inputCost に計上されない', () => {
    // field のみ + 多数の POP → food buyOrders 大 → price 上昇。だが field は入力なしで inputCost=0。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    const a = withAsset(state, hd, 'farm', 1, undefined, GRAIN_ONLY)
    state = a.state
    state = withEmployedPop(state, hd, 'lower', 50) // 供給
    // upper はどの asset にも雇用されない (§13.4) ため純粋な需要源にできる。
    // v0.58: money 制約があるため afford=1 となる潤沢な money を与える。
    state = withEmployedPop(state, hd, 'upper', 400, 50, true, undefined, 400000) // food 需要のみ
    // v0.58 balance: default の popEssentialNeedScale=0.5 では需要が半減し price==base になるため、
    //   essential 需要が価格を押し上げる構造そのものを検証するこのテストは scale=1 で確認する。
    const result = runEcon(state, { ...defaultConfig, popEssentialNeedScale: 1 })
    const snap = result.monthlyHoldingResourceRevenue[hd]!
    const ar = snap.assetResults.find((r) => (r.assetId as string) === (a.assetId as string))!
    // POP の food 需要は market buyOrders を押し上げる (price>base)
    expect(result.marketResourcePrices['sr-0:grain']!.lastPrice).toBeGreaterThan(
      RESOURCE_PRICE_DEFINITIONS.grain.basePrice,
    )
    // しかし POP コストは asset の inputCost に計上されない (二層性)
    expect(ar.inputCost).toBe(0)
    expect(ar.netRevenue).toBeGreaterThan(0)
  })

  it('v0.58: money 潤沢でも市場欠乏なら needSatisfaction が下がる (afford=1, fill 低)', () => {
    // 生産 asset の無い市場 → POP の essential need が市場で満たせない (marketFill=0)。
    //   money は潤沢 (afford=1) でも fill が 0 なので needSatisfaction が初期 (50) を下回る。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withEmployedPop(state, hd, 'lower', 100, 50, true, undefined, 100000) // money 潤沢
    const result = runEcon(state)
    const popId = state.popIndex.byHolding[hd]![0]!
    const pop = result.popGroups[popId]!
    expect(pop.needSatisfaction).toBeLessThan(50)
  })

  it('v0.58: money 不足の POP は essential を買い切れず needSatisfaction が下がる (market 潤沢でも)', () => {
    // grain 専業 farm + 潤沢 money の就業 POP で market を満たす (fill 高)。
    //   別に「未就業・money 極小」の貧困 POP を置く — 賃金を得ないため money が枯れ、afford 低で
    //   needSatisfaction が初期 (50) を下回り、money をほぼ使い切る (負にならない)。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'farm', 3).state // 大供給で market 潤沢
    state = withEmployedPop(state, hd, 'lower', 100, 50, true, undefined, 100000) // 供給+潤沢 money
    // 消費専用の貧困 POP (未就業=賃金なし・money 極小・upper はどの asset にも雇用されない)。
    state = withEmployedPop(state, hd, 'upper', 50, 50, false, undefined, 1)
    const result = runEcon(state)
    const poor = Object.values(result.popGroups).find((p) => p.class === 'upper')!
    expect(poor.needSatisfaction).toBeLessThan(50) // 買えないので低下
    expect(poor.money).toBeLessThan(1) // money をほぼ使い切る
    expect(poor.money).toBeGreaterThanOrEqual(0) // 負にならない
  })

  it('需要 0 の NeedCategory は wellbeing 集計に含めない (§16.1)', () => {
    // v0.58: lower pop は POP_NEED_PROFILES の luxury_* が 0 のため luxury カテゴリを需要しない
    //   (旧 purchasingPowerFactor の floor 0 ではなく profile=0 が理由)。essential のみ需要する。
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    // grain 専業 farm を十分に置き staple は満たす。
    state = withAsset(state, hd, 'farm', 1, undefined, GRAIN_ONLY).state
    state = withEmployedPop(state, hd, 'lower', 100, 0)
    const needs = computePopNeedDemand(
      state.popGroups[state.popIndex.byHolding[hd]![0]!]!,
      defaultConfig,
      (r) => RESOURCE_PRICE_DEFINITIONS[r].basePrice,
    )
    // wealth 0 の lower pop は luxury カテゴリを需要しない。
    expect(needs.some((n) => n.tier === 'luxury')).toBe(false)
    // essential は需要する。
    expect(needs.some((n) => n.tier === 'essential')).toBe(true)
  })

  it('does not consume RNG and does not mutate treasury (Phase 2-3 side-effect boundary)', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    state = withAsset(state, hd, 'farm').state
    state = withEmployedPop(state, hd, 'lower', 100)
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
    const a1 = withAsset(state, hd, 'farm', 2)
    state = a1.state
    const a2 = withAsset(state, hd, 'mountain', 1)
    state = a2.state
    state = withEmployedPop(state, hd, 'lower', 137)

    const assets = [state.realEstateAssets[a1.assetId]!, state.realEstateAssets[a2.assetId]!]
    const allocated = computeAllocatedLaborByAsset(state, defaultConfig, hd, assets)
    const total = (allocated.get(a1.assetId) ?? 0) + (allocated.get(a2.assetId) ?? 0)
    expect(total).toBeCloseTo(137, 6)
  })

  it('class with no receiving asset contributes no labor (idle, not double-counted)', () => {
    let state = makeEmptyV016State()
    state = withProvince(state, 'pr-0' as ProvinceId, {})
    const hd = firstHoldingId(state, 'pr-0' as ProvinceId)
    const a1 = withAsset(state, hd, 'farm')
    state = a1.state
    // upper はどの asset にも雇用されない (§13.4) ので配分されない。
    state = withEmployedPop(state, hd, 'lower', 80)
    state = withEmployedPop(state, hd, 'upper', 40)

    const assets = [state.realEstateAssets[a1.assetId]!]
    const allocated = computeAllocatedLaborByAsset(state, defaultConfig, hd, assets)
    expect(allocated.get(a1.assetId)).toBeCloseTo(80, 6)
  })
})

describe('recipeSlots default', () => {
  it('default recipeSlots total equals realEstateRecipeSlotCount', () => {
    for (const kind of ['farm', 'mountain', 'woodland', 'workshop'] as RealEstateKind[]) {
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
    const a = withAsset(state, hd, 'farm', 1, owner)
    state = a.state
    state = withEmployedPop(state, hd, 'lower', 100)
    const result = runEcon(state)
    const snap = result.monthlyHoldingResourceRevenue[hd]
    const ar = snap!.assetResults.find((r) => (r.assetId as string) === (a.assetId as string))
    expect(ar).toBeDefined()
    expect(ar!.netRevenue).toBeGreaterThan(0)
  })
})
