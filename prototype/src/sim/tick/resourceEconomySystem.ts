import type { TickContext } from './context'
import type {
  StateRegionId,
  HoldingId,
  ProductionRecipeId,
  PopGroupId,
  ProjectId,
  CrisisId,
} from '../types/ids'
import { FOOD_RESOURCE_VALUE } from '../config/popFoodDefinitions'
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
import { getSmoothedPriceOrBase } from '../config/resourceEconomyDefinitions'
import {
  computeAllocatedLaborByAsset,
  computeAssetRecipePotentials,
} from '../selectors/resourceProductionSelectors'
import type { ResolvedInputCategory } from '../selectors/resourceProductionSelectors'
import { RESOURCE_LEVELS, RESOURCE_LEVELS_SORTED } from '../selectors/resourceGraph'
import {
  computeProjectMaterialBaseUnits,
  getProjectMarketKey,
} from '../selectors/projectMaterialSelectors'
import {
  computeResourcePrice,
  computeMarketFulfillment,
  computePopNeedDemand,
} from '../selectors/resourceMarketSelectors'
import type { ResolvedNeedCategory } from '../selectors/resourceMarketSelectors'
import { clamp, clamp100 } from '../utils/math'
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
  inputCategories: ResolvedInputCategory[]
  // §14.3 laborTypeFulfillmentModifier (観察用)。Pass 2 で asset 単位に slotCount 加重集約する。
  laborTypeFulfillment: number
}

type MarketAccum = {
  marketKey: string
  recipes: RecipeRecord[]
  // §12: 全 resource の buyOrders (POP 消費需要 + recipe input 需要)。supply は清算ループで level 昇順に算出。
  demand: Record<ResourceKind, number>
  // §16: 各 POP の NeedCategory 解決を保持し、清算後の per-pop wellbeing 計算に使う。
  popDemands: { popId: PopGroupId; needs: ResolvedNeedCategory[] }[]
}

function emptyResourceRecord(): Record<ResourceKind, number> {
  const r = {} as Record<ResourceKind, number>
  for (const k of RESOURCE_KINDS) r[k] = 0
  return r
}

export function runResourceEconomySystem(ctx: TickContext): TickContext {
  const { state, config } = ctx
  const log = createLogger(config.debug)
  const week = state.absoluteWeek

  // v0.55 §B: active な干魃 Crisis の holding → severity を引く。食料 recipe の産出を減衰させ、
  //   foodSupply 低下 → 扶養力低下 → 飢饉の原因とする。determinism: crisis key sorted 反復。
  const droughtSeverityByHolding = new Map<string, number>()
  for (const cid of (Object.keys(state.crises) as CrisisId[]).sort()) {
    const c = state.crises[cid]
    if (!c || c.kind !== 'drought' || c.status !== 'active') continue
    const key = c.holdingId as string
    const prev = droughtSeverityByHolding.get(key) ?? 0
    if (c.severity > prev) droughtSeverityByHolding.set(key, c.severity)
  }
  // 食料 recipe 産出への干魃減衰倍率 (食料以外・干魃無しは 1)。供給集計と per-asset 売却益の双方で使う。
  const droughtOutputScale = (holdingId: HoldingId, resource: ResourceKind): number => {
    if (FOOD_RESOURCE_VALUE[resource] === undefined) return 1
    const sev = droughtSeverityByHolding.get(holdingId)
    if (sev === undefined) return 1
    return Math.max(
      config.droughtFoodOutputFloor,
      1 - config.droughtFoodOutputPenaltyRate * (sev / 100),
    )
  }

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
      demand: emptyResourceRecord(),
      popDemands: [],
    }
    markets.push(accum)

    // §6.3 share 解決用の前月 smoothedPrice (cold-start は basePrice fallback §4.3a)。
    const marketPriceLookup = (resource: ResourceKind): number => {
      const ps = state.marketResourcePrices[marketResourcePriceKey(marketKey, resource)]
      return getSmoothedPriceOrBase(ps?.smoothedPrice, resource)
    }

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
            marketPriceLookup,
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
              inputCategories: rp.inputCategories,
              laborTypeFulfillment: rp.laborTypeFulfillment,
            })

            // recipe input の潜在需要 (§12.3 step 2)。supply は清算ループで level 昇順に算出する。
            for (const r of RESOURCE_KINDS) {
              const potIn = rp.potentialInputs[r]
              if (potIn !== undefined) accum.demand[r] += potIn
            }
          }
        }

        // POP の消費需要 (§5.4 / §12.3 step 3): NeedCategory 別需要を ResourceKind buyOrders へ展開。
        const popIds = state.popIndex.byHolding[holdingId] ?? []
        for (const popId of popIds) {
          const pop = state.popGroups[popId]
          if (!pop) continue
          const needs = computePopNeedDemand(pop, config, marketPriceLookup)
          for (const cat of needs) {
            for (const res of cat.resources) {
              accum.demand[res.resource] += res.buyOrders
            }
          }
          accum.popDemands.push({ popId, needs })
        }
      }
    }
  }

  // ─── §18.4: 建設・修繕 Project の建築資材需要を月次 buyOrders へ注入する ───
  //   active な対象 Project を sorted 列挙し、対象 holding の StateRegion 市場へ per-advance baseUnits を加算。
  const marketByKey = new Map<string, MarketAccum>()
  for (const m of markets) marketByKey.set(m.marketKey, m)
  for (const projectId of (Object.keys(state.projects) as ProjectId[]).sort()) {
    const project = state.projects[projectId]
    if (!project || project.status !== 'active') continue
    const baseUnits = computeProjectMaterialBaseUnits(state, config, project)
    if (baseUnits.length === 0) continue
    const marketKey = getProjectMarketKey(state, project)
    if (marketKey === null) continue
    const market = marketByKey.get(marketKey)
    if (!market) continue
    for (const u of baseUnits) market.demand[u.resource] += u.baseUnits
  }

  // ─── 市場解決 (§12.3 DAG topological clearing) ───
  // 各 market を resource level 昇順に清算する (下記ループ内)。
  const newPrices: Record<string, MarketResourcePriceState> = {}
  const snapshots: Record<HoldingId, HoldingResourceRevenueSnapshot> = {}
  // §16: staple/ordinary の充足率・価格を POP wealth/unrest に反映する。
  const newPopGroups: Record<PopGroupId, PopGroup> = { ...state.popGroups }

  for (const market of markets) {
    // ─── 市場清算 (§12 DAG 化) ───
    // demand は pass 1 で全 resource 分を計上済み (POP 需要 + recipe input 需要)。
    // supply は resource level 昇順に increment 計算する: level-N resource の supply は
    //   Σ(potentialOutput × inputShortageModifier)。modifier は下位 level の
    //   fulfillment が確定するまで分からないため up-front では計算しない (§12.2)。
    const price: Record<ResourceKind, number> = emptyResourceRecord()
    const sellOrders: Record<ResourceKind, number> = emptyResourceRecord()
    const buyOrders: Record<ResourceKind, number> = emptyResourceRecord()
    const fulfillment: Record<
      ResourceKind,
      { fulfillmentRatio: number; shortage: boolean; shortageSeverity: number }
    > = {} as Record<
      ResourceKind,
      { fulfillmentRatio: number; shortage: boolean; shortageSeverity: number }
    >
    // 清算で全 resource を level ごとに必ず再代入する。init は型のため (sentinel: 需要ゼロ扱い)。
    for (const r of RESOURCE_KINDS) {
      fulfillment[r] = { fulfillmentRatio: 1, shortage: false, shortageSeverity: 0 }
      buyOrders[r] = market.demand[r]
    }

    // recipe の input fulfillment scale (Liebig 最小律 §12.4)。input が無ければ 1。
    //   category 単位で評価する: categoryFulfillment = Σ share_i × fulfillmentRatio_i (§6.3)、
    //   その最小を取る (substitutable な同 category 内 resource は share 加重平均、category 間は最小律)。
    //   下位 level が clearing 済みであることに依存する (level 昇順反復で保証)。
    const recipeInputScale = (rec: RecipeRecord): number => {
      if (rec.inputCategories.length === 0) return 1
      let scale = 1
      for (const cat of rec.inputCategories) {
        let catFulfillment = 0
        for (const res of cat.resources) {
          catFulfillment += res.share * fulfillment[res.resource].fulfillmentRatio
        }
        if (catFulfillment < scale) scale = catFulfillment
      }
      return scale
    }

    // v0.55 §12.4/§12.5 (抽象市場改訂): input shortage を「実配給 0」ではなく floor 付きの output
    //   penalty として扱う (Victoria 3 的)。supply 0 でも inputShortageOutputFloor 倍は生産を続け、
    //   input は market price で購入扱い (希少時は高価な input × 低 output → 低利益/赤字)。これにより
    //   price シグナルが生き、上位 recipe (例 gem_mine) への転換動機が残る。
    //   raw recipe (input 無し) は recipeInputScale=1 → modifier=1 で無影響。
    //   inputFulfillmentScale (Liebig 最小律) は従来どおり計算し、floor 付き modifier へ変換してから
    //   actualOutput / actualInputConsumed に掛ける (直接 actualOutput には掛けない)。
    const inputShortageModifier = (rec: RecipeRecord): number => {
      const floor = config.inputShortageOutputFloor
      return floor + (1 - floor) * recipeInputScale(rec)
    }

    // resource level 昇順に supply を確定し clearing する (§12.3)。
    for (const level of RESOURCE_LEVELS_SORTED) {
      for (const resource of RESOURCE_KINDS) {
        if (RESOURCE_LEVELS[resource] !== level) continue
        let sell = 0
        for (const rec of market.recipes) {
          const pot = rec.potentialOutputs[resource]
          if (pot === undefined) continue
          sell += pot * inputShortageModifier(rec) * droughtOutputScale(rec.holdingId, resource)
        }
        const buy = buyOrders[resource]
        price[resource] = computeResourcePrice(resource, sell, buy, config)
        fulfillment[resource] = computeMarketFulfillment(sell, buy, config)
        sellOrders[resource] = sell
      }
    }

    // ─── Pass 2: per-asset 売却益 (§12.5 課金ポリシー) ───
    // produced は全量 price で売れる (sellRatio 廃止)。input shortage 時は floor 付き
    //   inputShortageModifier で actualOutput を減衰させ、input は同 modifier で実消費・実コストを
    //   pro-rate する (§12.5 改訂): actualInputConsumed = desiredInput × inputShortageModifier。
    //   供給 0 でも floor 倍は生産・購入するため、希少 input は高価格で課金され低利益/赤字となる。
    // recipe を asset 単位に集約し、asset を holding snapshot にまとめる。
    const assetResultByAsset = new Map<string, RealEstateProductionResult>()
    const assetOrderByHolding = new Map<string, string[]>()
    // 観察用充足率の slotCount 加重集約: 集計中は inputFulfillment/laborTypeFulfillment に
    //   Σ(slotCount × value) を貯め、snapshot 組み立て時に ΣslotCount で正規化する。
    const fulfillmentWeightByAsset = new Map<string, number>()
    for (const rec of market.recipes) {
      const outputScale = inputShortageModifier(rec)
      const recipeInputFulfillment = recipeInputScale(rec) // raw Liebig 最小律 (0..1, input 無し=1)

      const recipeOutputs: Partial<Record<ResourceKind, number>> = {}
      const recipeInputs: Partial<Record<ResourceKind, number>> = {}
      let recipeGross = 0
      let recipeInputCost = 0
      for (const r of RESOURCE_KINDS) {
        const pot = rec.potentialOutputs[r]
        if (pot !== undefined) {
          // 全量売却 (在庫なし・市場抽象化)。干魃 holding の食料産出は減衰 (§B)。
          const produced = pot * outputScale * droughtOutputScale(rec.holdingId, r)
          recipeOutputs[r] = produced
          recipeGross += produced * price[r]
        }
      }
      // §12.5 pro-rate: floor 付き inputShortageModifier に合わせて実消費・実コストを縮小する。
      //   category 解決済みの resource 別 buyOrders を outputScale (= modifier) で按分課金する。
      for (const cat of rec.inputCategories) {
        for (const res of cat.resources) {
          const consumed = res.buyOrders * outputScale
          recipeInputs[res.resource] = (recipeInputs[res.resource] ?? 0) + consumed
          recipeInputCost += consumed * price[res.resource]
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
          inputFulfillment: 0, // 集計中は Σ(slotCount × value)、後で正規化
          laborTypeFulfillment: 0,
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
      // 充足率の slotCount 加重和を貯める (正規化は snapshot 組み立て時)。
      assetResult.inputFulfillment += recipeInputFulfillment * rec.slotCount
      assetResult.laborTypeFulfillment += rec.laborTypeFulfillment * rec.slotCount
      fulfillmentWeightByAsset.set(
        assetKey,
        (fulfillmentWeightByAsset.get(assetKey) ?? 0) + rec.slotCount,
      )
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
        // slotCount 加重和を平均へ正規化 (weight 0 は理論上発生しないが念のため 1 扱い)。
        const weight = fulfillmentWeightByAsset.get(assetKey) ?? 0
        if (weight > 0) {
          ar.inputFulfillment /= weight
          ar.laborTypeFulfillment /= weight
        } else {
          ar.inputFulfillment = 1
          ar.laborTypeFulfillment = 1
        }
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

    // ─── §16: NeedCategory 別 fulfillment を per-pop で集計し wealth/unrest へ反映 ───
    //   各 pop の need 解決 (pass1 で smoothedPrice ベースに確定済み) を使い、各 category の
    //   categoryFulfillment = Σ share_i × marketFulfillmentRatio_i (need value 加重, §16.1) を求める。
    //   shortage = 1 - fulfillment。tier 別 penalty を weekly delta に積む (§16.2)。
    //   需要 0 の category は pass1 で除外済み (resources 空は popDemands に入らない)。
    //   NOTE: pop.wealth は 0..100 の指数なので spec §16.2 の ×pop.size は適用しない (index delta)。
    for (const { popId, needs } of market.popDemands) {
      if (needs.length === 0) continue
      const pop = newPopGroups[popId]
      if (!pop) continue
      let wealthDelta = 0
      let unrestDelta = 0
      for (const cat of needs) {
        let fulfillmentC = 0
        for (const res of cat.resources) {
          fulfillmentC += res.share * fulfillment[res.resource].fulfillmentRatio
        }
        const shortage = 1 - clamp(fulfillmentC, 0, 1)
        if (shortage <= 0) continue
        wealthDelta -= config.needShortageWealthPenaltyByTier[cat.tier] * shortage
        unrestDelta += config.needShortageUnrestPenaltyByTier[cat.tier] * shortage
      }
      if (wealthDelta !== 0 || unrestDelta !== 0) {
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
