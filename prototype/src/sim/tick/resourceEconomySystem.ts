import type { TickContext } from './context'
import type { StateRegionId, HoldingId, ProductionRecipeId } from '../types/ids'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { ResourceKind } from '../types/resource'
import type {
  MarketResourcePriceState,
  MarketResourcePricePoint,
  HoldingResourceRevenueSnapshot,
  RealEstateProductionResult,
  ProductionRecipeResult,
} from '../types/resourceEconomy'
import { RESOURCE_KINDS } from '../types/resource'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import {
  computeAllocatedLaborByAsset,
  computeAssetRecipePotentials,
} from '../selectors/resourceProductionSelectors'
import { computeResourcePrice, getPopResourceDemand } from '../selectors/resourceMarketSelectors'
import { createLogger } from '../debug/logger'

// v0.54 §13 ResourceEconomySystem: 月次 (intervalWeeks:4) で資源生産・市場・売却益を解決し、
//   marketResourcePrices / monthlyHoldingResourceRevenue の 2 slice にだけ書き込む。
//   POP / treasury / owner は変更しない (side-effect-free, §16 / Step 2)。RNG を消費しない。
//   determinism: 全 Record 反復を sorted key 順 (§13.1)。array (provinceIds/holdingIds/assetIds) は
//   既に固定順なのでそのまま使う。
//
//   POP wealth/unrest への反映 (§13 step 13 / §19) は Phase 4 で追加する。本 system は step 1-12 まで。

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
        }
      }
    }
  }

  // ─── 市場解決 (§13 step 5-9) ───
  // raw_materials を先に解決 → rawFulfillmentRatio → processed_goods supply を確定。
  const newPrices: Record<string, MarketResourcePriceState> = {}
  const snapshots: Record<HoldingId, HoldingResourceRevenueSnapshot> = {}

  for (const market of markets) {
    // raw market
    const rawSupply = market.supply.raw_materials
    const rawDemand = market.demand.raw_materials
    const rawPrice = computeResourcePrice('raw_materials', rawSupply, rawDemand, config)
    const rawSold = Math.min(rawSupply, rawDemand)
    const rawFulfillmentRatio = rawDemand > 0 ? rawSold / rawDemand : 1
    const rawSellRatio = rawSupply > 0 ? rawSold / rawSupply : 0

    // processed supply = Σ workshop potential processed × rawFulfillmentRatio。
    let processedSupply = 0
    for (const rec of market.recipes) {
      const pp = rec.potentialOutputs.processed_goods
      if (pp !== undefined && rec.potentialInputs.raw_materials !== undefined) {
        processedSupply += pp * rawFulfillmentRatio
      } else if (pp !== undefined) {
        processedSupply += pp
      }
    }
    market.supply.processed_goods = processedSupply

    // food / processed market
    const foodSupply = market.supply.food
    const foodDemand = market.demand.food
    const foodPrice = computeResourcePrice('food', foodSupply, foodDemand, config)
    const foodSold = Math.min(foodSupply, foodDemand)
    const foodSellRatio = foodSupply > 0 ? foodSold / foodSupply : 0

    const processedDemand = market.demand.processed_goods
    const processedPrice = computeResourcePrice(
      'processed_goods',
      processedSupply,
      processedDemand,
      config,
    )
    const processedSold = Math.min(processedSupply, processedDemand)
    const processedSellRatio = processedSupply > 0 ? processedSold / processedSupply : 0

    const price: Record<ResourceKind, number> = {
      food: foodPrice,
      raw_materials: rawPrice,
      processed_goods: processedPrice,
    }
    const sellRatio: Record<ResourceKind, number> = {
      food: foodSellRatio,
      raw_materials: rawSellRatio,
      processed_goods: processedSellRatio,
    }
    const sold: Record<ResourceKind, number> = {
      food: foodSold,
      raw_materials: rawSold,
      processed_goods: processedSold,
    }
    const effectiveDemand: Record<ResourceKind, number> = {
      food: foodDemand,
      raw_materials: rawDemand,
      processed_goods: processedDemand,
    }

    // ─── Pass 2: per-asset 売却益 (§13 step 10-11) ───
    // recipe を asset 単位に集約し、asset を holding snapshot にまとめる。
    const assetResultByAsset = new Map<string, RealEstateProductionResult>()
    const assetOrderByHolding = new Map<string, string[]>()
    for (const rec of market.recipes) {
      const inputScale = rec.potentialInputs.raw_materials !== undefined ? rawFulfillmentRatio : 1

      const recipeOutputs: Partial<Record<ResourceKind, number>> = {}
      const recipeSold: Partial<Record<ResourceKind, number>> = {}
      const recipeInputs: Partial<Record<ResourceKind, number>> = {}
      let recipeGross = 0
      let recipeInputCost = 0
      for (const r of RESOURCE_KINDS) {
        const pot = rec.potentialOutputs[r]
        if (pot !== undefined) {
          const produced = pot * inputScale
          const soldAmt = produced * sellRatio[r]
          recipeOutputs[r] = produced
          recipeSold[r] = soldAmt
          recipeGross += soldAmt * price[r]
        }
        const potIn = rec.potentialInputs[r]
        if (potIn !== undefined) {
          const consumed = potIn * inputScale
          recipeInputs[r] = consumed
          recipeInputCost += consumed * price[r]
        }
      }
      const recipeNet = recipeGross - recipeInputCost
      const recipeResult: ProductionRecipeResult = {
        recipeId: rec.recipeId,
        slotCount: rec.slotCount,
        allocatedLabor: rec.recipeLabor,
        outputs: recipeOutputs,
        inputs: recipeInputs,
        soldOutputs: recipeSold,
        grossRevenue: recipeGross,
        inputCost: recipeInputCost,
        netRevenue: recipeNet,
      }

      const assetKey = rec.asset.id as string
      let assetResult = assetResultByAsset.get(assetKey)
      if (!assetResult) {
        assetResult = {
          assetId: rec.asset.id,
          holdingId: rec.holdingId,
          outputs: {},
          inputs: {},
          soldOutputs: {},
          grossRevenue: 0,
          inputCost: 0,
          netRevenue: 0,
          recipeResults: [],
        }
        assetResultByAsset.set(assetKey, assetResult)
        const hKey = rec.holdingId as string
        const order = assetOrderByHolding.get(hKey) ?? []
        order.push(assetKey)
        assetOrderByHolding.set(hKey, order)
      }
      assetResult.recipeResults.push(recipeResult)
      assetResult.grossRevenue += recipeGross
      assetResult.inputCost += recipeInputCost
      assetResult.netRevenue += recipeNet
      for (const r of RESOURCE_KINDS) {
        if (recipeOutputs[r] !== undefined)
          assetResult.outputs[r] = (assetResult.outputs[r] ?? 0) + (recipeOutputs[r] ?? 0)
        if (recipeSold[r] !== undefined)
          assetResult.soldOutputs[r] = (assetResult.soldOutputs[r] ?? 0) + (recipeSold[r] ?? 0)
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

    // ─── 価格履歴更新 (§13 step 12) ───
    for (const resource of RESOURCE_KINDS) {
      const key = marketResourcePriceKey(market.marketKey, resource)
      const prev = state.marketResourcePrices[key]
      const currentPrice = price[resource]
      const smoothedPrice = prev
        ? prev.smoothedPrice * config.marketPriceSmoothingPreviousWeight +
          currentPrice * config.marketPriceSmoothingCurrentWeight
        : currentPrice
      const point: MarketResourcePricePoint = {
        week,
        price: currentPrice,
        supply: market.supply[resource],
        effectiveDemand: effectiveDemand[resource],
        sold: sold[resource],
        unmetDemand: Math.max(0, effectiveDemand[resource] - market.supply[resource]),
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
          supply: market.supply[resource].toFixed(2),
          demand: effectiveDemand[resource].toFixed(2),
          sold: sold[resource].toFixed(2),
          unmet: Math.max(0, effectiveDemand[resource] - market.supply[resource]).toFixed(2),
        })
      }
    }
  }

  return {
    ...ctx,
    state: {
      ...state,
      marketResourcePrices: newPrices,
      monthlyHoldingResourceRevenue: snapshots,
    },
  }
}
