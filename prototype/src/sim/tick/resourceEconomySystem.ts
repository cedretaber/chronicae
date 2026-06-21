import type { TickContext } from './context'
import type { StateRegionId, HoldingId, ProductionRecipeId, PopGroupId } from '../types/ids'
import type { PopGroup } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { ResourceKind } from '../types/resource'
import type {
  MarketResourcePriceState,
  MarketResourcePricePoint,
  HoldingResourceRevenueSnapshot,
  RealEstateProductionResult,
} from '../types/resourceEconomy'
import { RESOURCE_KINDS } from '../types/resource'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import {
  computeAllocatedLaborByAsset,
  computeAssetRecipePotentials,
} from '../selectors/resourceProductionSelectors'
import { RESOURCE_LEVELS, RESOURCE_LEVELS_SORTED } from '../selectors/resourceGraph'
import {
  computeResourcePrice,
  computeMarketFulfillment,
  getPopResourceDemand,
} from '../selectors/resourceMarketSelectors'
import { clamp100 } from '../utils/math'
import { createLogger } from '../debug/logger'

// v0.54 §13 ResourceEconomySystem: 月次 (intervalWeeks:4) で資源生産・市場・売却益を解決し、
//   marketResourcePrices / monthlyHoldingResourceRevenue を書き、food/processed の充足率・価格を
//   POP wealth/unrest に反映する (§13 step 1-13 / §19)。treasury / owner は変更しない (分配は landRevenue)。
//   RNG を消費しない。determinism: 全 Record 反復を sorted key 順 (§13.1)。array (provinceIds/
//   holdingIds/assetIds/popGroupIds) は既に固定順なのでそのまま使う。

type RecipeRecord = {
  holdingId: HoldingId
  asset: RealEstateAsset
  recipeId: ProductionRecipeId
  slotCount: number
  recipeLabor: number
  potentialOutputs: Partial<Record<ResourceKind, number>>
  potentialInputs: Partial<Record<ResourceKind, number>>
}

type MarketAccum = {
  marketKey: string
  recipes: RecipeRecord[]
  supply: Record<ResourceKind, number>
  demand: Record<ResourceKind, number>
  // §19: market 内の POP に food/processed の充足率・価格を反映するため popId を集める。
  popGroupIds: PopGroupId[]
}

function emptyResourceRecord(): Record<ResourceKind, number> {
  return { food: 0, raw_materials: 0, processed_goods: 0 }
}

export function runResourceEconomySystem(ctx: TickContext): TickContext {
  const { state, config } = ctx
  const log = createLogger(config.debug)
  const week = state.absoluteWeek

  // marketKey ごとの集計。states を sorted key 順で反復し、market を生成順に並べる。
  const markets: MarketAccum[] = []
  const stateIds = (Object.keys(state.states) as StateRegionId[]).sort()

  // ─── Pass 1: 生産集計 (§13 step 2-4) + POP 需要 (step 8) ───
  for (const stateId of stateIds) {
    const region = state.states[stateId]
    if (!region) continue
    const marketKey = stateId as string
    const accum: MarketAccum = {
      marketKey,
      recipes: [],
      supply: emptyResourceRecord(),
      demand: emptyResourceRecord(),
      popGroupIds: [],
    }
    markets.push(accum)

    for (const provinceId of region.provinceIds) {
      const province = state.provinces[provinceId]
      if (!province) continue

      for (const holdingId of province.holdingIds) {
        const holding = state.holdings[holdingId]
        if (!holding) continue

        const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
        const assets: RealEstateAsset[] = []
        for (const aId of assetIds) {
          const asset = state.realEstateAssets[aId]
          if (asset) assets.push(asset)
        }
        const allocatedByAsset = computeAllocatedLaborByAsset(state, config, holdingId, assets)

        for (const asset of assets) {
          const allocatedLabor = allocatedByAsset.get(asset.id) ?? 0
          const recipePotentials = computeAssetRecipePotentials(
            state,
            config,
            asset,
            allocatedLabor,
          )

          for (const rp of recipePotentials) {
            accum.recipes.push({
              holdingId,
              asset,
              recipeId: rp.recipeId,
              slotCount: rp.slotCount,
              recipeLabor: rp.recipeLabor,
              potentialOutputs: rp.potentialOutputs,
              potentialInputs: rp.potentialInputs,
            })

            // 一次生産の supply 集計: food (field) / raw_materials (pasture)。
            //   processed_goods は raw 充足後に決まるためここでは加えない。
            const foodOut = rp.potentialOutputs.food
            if (foodOut !== undefined) accum.supply.food += foodOut
            const rawOut = rp.potentialOutputs.raw_materials
            if (rawOut !== undefined) accum.supply.raw_materials += rawOut
            // workshop の raw 潜在需要 (§13 step 4)。
            const rawIn = rp.potentialInputs.raw_materials
            if (rawIn !== undefined) accum.demand.raw_materials += rawIn
          }
        }

        // POP の food / processed_goods 需要 (§13 step 8)。
        const popIds = state.popIndex.byHolding[holdingId] ?? []
        for (const popId of popIds) {
          const pop = state.popGroups[popId]
          if (!pop) continue
          accum.demand.food += getPopResourceDemand(pop, 'food', config)
          accum.demand.processed_goods += getPopResourceDemand(pop, 'processed_goods', config)
          accum.popGroupIds.push(popId)
        }
      }
    }
  }

  // ─── 市場解決 (§13 step 5-9) ───
  // raw_materials を先に解決 → rawFulfillmentRatio → processed_goods supply を確定。
  const newPrices: Record<string, MarketResourcePriceState> = {}
  const snapshots: Record<HoldingId, HoldingResourceRevenueSnapshot> = {}
  // §19: food/processed の充足率・価格を POP wealth/unrest に反映する (Phase 4)。
  const newPopGroups: Record<PopGroupId, PopGroup> = { ...state.popGroups }

  for (const market of markets) {
    // ─── 市場清算 (§12 DAG 化) ───
    // demand は pass 1 で全 resource 分を計上済み (POP 需要 + recipe input 需要)。
    // supply は resource level 昇順に increment 計算する: level-N resource の supply は
    //   Σ(potentialOutput × inputFulfillmentScale)。inputFulfillmentScale は下位 level の
    //   fulfillment が確定するまで分からないため up-front では計算しない (§12.2)。
    const price: Record<ResourceKind, number> = emptyResourceRecord()
    const sellOrders: Record<ResourceKind, number> = emptyResourceRecord()
    const buyOrders: Record<ResourceKind, number> = emptyResourceRecord()
    const zeroFulfill = () => ({ fulfillmentRatio: 1, shortage: false, shortageSeverity: 0 })
    const fulfillment: Record<
      ResourceKind,
      { fulfillmentRatio: number; shortage: boolean; shortageSeverity: number }
    > = {
      food: zeroFulfill(),
      raw_materials: zeroFulfill(),
      processed_goods: zeroFulfill(),
    }
    for (const r of RESOURCE_KINDS) buyOrders[r] = market.demand[r]

    // recipe の input fulfillment scale (Liebig 最小律 §12.4)。input が無ければ 1。
    //   下位 level が clearing 済みであることに依存する (level 昇順反復で保証)。
    const recipeInputScale = (rec: RecipeRecord): number => {
      let scale = 1
      let hasInput = false
      for (const r of RESOURCE_KINDS) {
        if (rec.potentialInputs[r] === undefined) continue
        hasInput = true
        const f = fulfillment[r].fulfillmentRatio
        if (f < scale) scale = f
      }
      return hasInput ? scale : 1
    }

    // resource level 昇順に supply を確定し clearing する (§12.3)。
    for (const level of RESOURCE_LEVELS_SORTED) {
      for (const resource of RESOURCE_KINDS) {
        if (RESOURCE_LEVELS[resource] !== level) continue
        let sell = 0
        for (const rec of market.recipes) {
          const pot = rec.potentialOutputs[resource]
          if (pot === undefined) continue
          sell += pot * recipeInputScale(rec)
        }
        const buy = buyOrders[resource]
        price[resource] = computeResourcePrice(resource, sell, buy, config)
        fulfillment[resource] = computeMarketFulfillment(sell, buy, config)
        sellOrders[resource] = sell
      }
    }

    const foodFulfill = fulfillment.food
    const processedFulfill = fulfillment.processed_goods

    // ─── Pass 2: per-asset 売却益 (§13 step 10-11 / §6.3c.1) ───
    // produced は全量 price で売れる (sellRatio 廃止)。workshop の raw input は不足でも buyOrders 全量 cost、
    // output (processed) だけ rawFulfillmentRatio で縮小する → raw 不足 workshop の netRevenue は負になり得る。
    // recipe を asset 単位に集約し、asset を holding snapshot にまとめる。
    const assetResultByAsset = new Map<string, RealEstateProductionResult>()
    const assetOrderByHolding = new Map<string, string[]>()
    for (const rec of market.recipes) {
      const outputScale = recipeInputScale(rec)

      const recipeOutputs: Partial<Record<ResourceKind, number>> = {}
      const recipeInputs: Partial<Record<ResourceKind, number>> = {}
      let recipeGross = 0
      let recipeInputCost = 0
      for (const r of RESOURCE_KINDS) {
        const pot = rec.potentialOutputs[r]
        if (pot !== undefined) {
          const produced = pot * outputScale // 全量売却 (在庫なし・市場抽象化)
          recipeOutputs[r] = produced
          recipeGross += produced * price[r]
        }
        const potIn = rec.potentialInputs[r]
        if (potIn !== undefined) {
          // input は buyOrders 全量 cost (不足でも満額払う)。inputScale を掛けない。
          recipeInputs[r] = potIn
          recipeInputCost += potIn * price[r]
        }
      }
      const recipeNet = recipeGross - recipeInputCost

      const assetKey = rec.asset.id as string
      let assetResult = assetResultByAsset.get(assetKey)
      if (!assetResult) {
        assetResult = {
          assetId: rec.asset.id,
          holdingId: rec.holdingId,
          outputs: {},
          inputs: {},
          grossRevenue: 0,
          inputCost: 0,
          netRevenue: 0,
        }
        assetResultByAsset.set(assetKey, assetResult)
        const hKey = rec.holdingId as string
        const order = assetOrderByHolding.get(hKey) ?? []
        order.push(assetKey)
        assetOrderByHolding.set(hKey, order)
      }
      assetResult.grossRevenue += recipeGross
      assetResult.inputCost += recipeInputCost
      assetResult.netRevenue += recipeNet
      for (const r of RESOURCE_KINDS) {
        if (recipeOutputs[r] !== undefined)
          assetResult.outputs[r] = (assetResult.outputs[r] ?? 0) + (recipeOutputs[r] ?? 0)
        if (recipeInputs[r] !== undefined)
          assetResult.inputs[r] = (assetResult.inputs[r] ?? 0) + (recipeInputs[r] ?? 0)
      }
    }

    // holding snapshot を組み立てる (holding は recipe 出現順 = 決定的)。
    for (const [holdingKey, assetKeys] of assetOrderByHolding) {
      const holdingId = holdingKey as HoldingId
      const assetResults: RealEstateProductionResult[] = []
      let totalNetRevenue = 0
      const byResource: Partial<Record<ResourceKind, number>> = {}
      for (const assetKey of assetKeys) {
        const ar = assetResultByAsset.get(assetKey)
        if (!ar) continue
        assetResults.push(ar)
        totalNetRevenue += Math.max(0, ar.netRevenue)
        for (const r of RESOURCE_KINDS) {
          if (ar.outputs[r] !== undefined)
            byResource[r] = (byResource[r] ?? 0) + (ar.outputs[r] ?? 0)
        }
      }
      snapshots[holdingId] = { holdingId, week, totalNetRevenue, byResource, assetResults }
    }

    // ─── 価格履歴更新 (§13 step 12 / §6.3c.1) ───
    for (const resource of RESOURCE_KINDS) {
      const key = marketResourcePriceKey(market.marketKey, resource)
      const prev = state.marketResourcePrices[key]
      const currentPrice = price[resource]
      const smoothedPrice = prev
        ? prev.smoothedPrice * config.marketPriceSmoothingPreviousWeight +
          currentPrice * config.marketPriceSmoothingCurrentWeight
        : currentPrice
      const sell = sellOrders[resource]
      const buy = buyOrders[resource]
      const f = fulfillment[resource]
      const point: MarketResourcePricePoint = {
        week,
        price: currentPrice,
        sellOrders: sell,
        buyOrders: buy,
        producerRevenue: sell * currentPrice,
        consumerCost: buy * currentPrice,
        fulfillmentRatio: f.fulfillmentRatio,
        shortage: f.shortage,
        shortageSeverity: f.shortageSeverity,
      }
      const history = prev ? [...prev.history, point] : [point]
      if (history.length > config.marketResourcePriceHistoryLimit) {
        history.splice(0, history.length - config.marketResourcePriceHistoryLimit)
      }
      newPrices[key] = {
        marketKey: market.marketKey,
        resource,
        lastPrice: currentPrice,
        smoothedPrice,
        history,
      }

      if (config.debug) {
        log.log('ECON', {
          state: market.marketKey,
          resource,
          price: currentPrice.toFixed(3),
          sell: sell.toFixed(2),
          buy: buy.toFixed(2),
          fulfill: f.fulfillmentRatio.toFixed(3),
          shortage: f.shortage ? f.shortageSeverity.toFixed(2) : '-',
        })
      }
    }

    // ─── §13 step 13 / §19: food/processed 充足率・価格を POP wealth/unrest に反映 ───
    // 負のチャネル: shortage 時 wealth-/unrest+ (shortageSeverity 比例)。
    // 高価格チャネル: priceMultiplier 超過に応じた生活費負担 (shortage とは別概念)。
    // 正のチャネル (§19.2, load-bearing): 充足かつ価格安定で wealth+/unrest- (fulfillmentRatio ベース)。
    //   market の値を同 market 内 POP に一律適用。clamp 0..100。
    // 重要: 正のチャネルは「その財を実際に需要している」ときのみ発火させる。buyOrders=0 の市場では
    //   fulfillmentRatio が sentinel の 1 を返すため、ゲートしないと需要ゼロの財で満額の満足ボーナスが
    //   付いてしまう (例: 加工品を需要しない貧困 peasant のみの市場)。需要ゼロは contentment 0 が正。
    const foodHasDemand = buyOrders.food > 0
    const processedHasDemand = buyOrders.processed_goods > 0
    const foodFulfillmentRatio = foodFulfill.fulfillmentRatio
    const foodShortageSeverity = foodFulfill.shortageSeverity
    const foodPriceExcess = Math.max(0, price.food / RESOURCE_PRICE_DEFINITIONS.food.basePrice - 1)
    // §19.2 正の効果は「充足 かつ 価格安定」が条件。価格高騰時は減衰させる。需要ゼロなら 0。
    const foodWellbeing = foodHasDemand
      ? foodFulfillmentRatio * Math.max(0, 1 - foodPriceExcess)
      : 0
    const processedShortageSeverity = processedFulfill.shortageSeverity
    const processedWellbeing = processedHasDemand ? processedFulfill.fulfillmentRatio : 0

    const wealthDelta =
      -config.foodShortageWealthPenalty * foodShortageSeverity -
      config.foodHighPriceWealthPenalty * foodPriceExcess +
      config.foodFulfillmentWealthGain * foodWellbeing -
      config.processedGoodsShortageWealthPenalty * processedShortageSeverity +
      config.processedGoodsFulfillmentWealthGain * processedWellbeing
    const unrestDelta =
      config.foodShortageUnrestGain * foodShortageSeverity +
      config.foodHighPriceUnrestGain * foodPriceExcess -
      config.foodFulfillmentUnrestReduction * foodWellbeing +
      config.processedGoodsShortageUnrestGain * processedShortageSeverity -
      config.processedGoodsFulfillmentUnrestReduction * processedWellbeing

    if (wealthDelta !== 0 || unrestDelta !== 0) {
      for (const popId of market.popGroupIds) {
        const pop = newPopGroups[popId]
        if (!pop) continue
        const newWealth = clamp100(pop.wealth + wealthDelta)
        const newUnrest = clamp100(pop.unrest + unrestDelta)
        if (newWealth !== pop.wealth || newUnrest !== pop.unrest) {
          newPopGroups[popId] = { ...pop, wealth: newWealth, unrest: newUnrest }
        }
      }
    }
  }

  return {
    ...ctx,
    state: {
      ...state,
      popGroups: newPopGroups,
      marketResourcePrices: newPrices,
      monthlyHoldingResourceRevenue: snapshots,
    },
  }
}
