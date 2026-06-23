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
  computeAssetPopTypeShares,
} from '../selectors/resourceProductionSelectors'
import { WAGE_ROLE_BY_POP_TYPE } from '../config/popWageDefinitions'
import type { PopType, PopStratum } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import { REAL_ESTATE_DEFINITIONS } from '../config/realEstateDefinitions'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
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
import type { NeedTier } from '../types/needCategory'
import { clamp, clamp100 } from '../utils/math'

// v0.58: 予算制約消費の tier 優先順（essential を最優先で money を充当する）。
const TIER_PRIORITY: readonly NeedTier[] = ['essential', 'ordinary', 'luxury']
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
}

type MarketAccum = {
  marketKey: string
  recipes: RecipeRecord[]
  // §12: 全 resource の buyOrders (POP 消費需要 + recipe input 需要)。supply は清算ループで level 昇順に算出。
  demand: Record<ResourceKind, number>
  // §16: 各 POP の NeedCategory 解決を保持し、清算後の per-pop wellbeing 計算に使う。
  //   v0.58: needs は予算制約後の placed order（buyOrders を tier 優先 afford で縮小済み）。
  //   affordByTier = 買えた割合（money 制約）、allocatedByTier = 充当 money（smoothedPrice 評価）。
  popDemands: {
    popId: PopGroupId
    needs: ResolvedNeedCategory[]
    affordByTier: Record<NeedTier, number>
    allocatedByTier: Record<NeedTier, number>
  }[]
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
            })

            // recipe input の潜在需要 (§12.3 step 2)。supply は清算ループで level 昇順に算出する。
            for (const r of RESOURCE_KINDS) {
              const potIn = rp.potentialInputs[r]
              if (potIn !== undefined) accum.demand[r] += potIn
            }
          }
        }

        // POP の消費需要 (§5.4 / §12.3 step 3): NeedCategory 別 full desired を ResourceKind buyOrders へ展開し、
        //   v0.58: start-of-tick money で **tier 優先 (essential→ordinary→luxury)** に予算制約する (§6.3c.5)。
        //   一律スケールではなく tier 優先にすることで、貧困 POP は「食料を満額・贅沢ゼロ」になる
        //   (一律だと「食料 30%＋贅沢 30%」で essential 充足が下がり飢餓と誤判定される)。
        //   評価価格は終始 smoothedPrice (marketPriceLookup) で、burn (Task 2.2) と基準を揃え money が負にならない。
        const popIds = state.popIndex.byHolding[holdingId] ?? []
        for (const popId of popIds) {
          const pop = state.popGroups[popId]
          if (!pop) continue
          const needs = computePopNeedDemand(pop, config, marketPriceLookup) // full desired
          let budget = pop.money // start-of-tick money（先月までの稼ぎ）
          const affordByTier: Record<NeedTier, number> = { essential: 0, ordinary: 0, luxury: 0 }
          const allocatedByTier: Record<NeedTier, number> = { essential: 0, ordinary: 0, luxury: 0 }
          for (const tier of TIER_PRIORITY) {
            let tierCost = 0
            for (const cat of needs) {
              if (cat.tier !== tier) continue
              for (const res of cat.resources) {
                tierCost += res.buyOrders * marketPriceLookup(res.resource)
              }
            }
            const spend = tierCost > 0 ? Math.min(budget, tierCost) : 0
            const afford = tierCost > 0 ? spend / tierCost : 0
            affordByTier[tier] = afford
            allocatedByTier[tier] = spend
            budget -= spend
            // placed order = full desired × afford。以降の充足率/burn でもこの placed を使う。
            for (const cat of needs) {
              if (cat.tier !== tier) continue
              for (const res of cat.resources) {
                const placed = res.buyOrders * afford
                res.buyOrders = placed
                accum.demand[res.resource] += placed
              }
            }
          }
          accum.popDemands.push({ popId, needs, affordByTier, allocatedByTier })
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
    // v0.58: needSatisfaction/burn の market-fill 評価用 smoothedPrice lookup (pass1 と同じ前月価格)。
    const marketPriceLookup = (resource: ResourceKind): number => {
      const ps = state.marketResourcePrices[marketResourcePriceKey(market.marketKey, resource)]
      return getSmoothedPriceOrBase(ps?.smoothedPrice, resource)
    }

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
    // 観察用 inputFulfillment の slotCount 加重集約: 集計中は Σ(slotCount × value) を貯め、
    //   snapshot 組み立て時に ΣslotCount で正規化する。
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
          recipeBreakdown: [],
          grossRevenue: 0,
          inputCost: 0,
          netRevenue: 0,
          wageShare: 0, // v0.58: 最終 pass の賃金 carve で確定
          ownerDividendShare: 0, // v0.58 balance: 最終 pass の upper 配当 carve で確定
          inputFulfillment: 0, // 集計中は Σ(slotCount × value)、後で正規化
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
      // v0.56 read-model: recipe 別内訳を保持 (rec は asset×recipeId で一意・出現順は決定的)。
      assetResult.recipeBreakdown.push({
        recipeId: rec.recipeId,
        outputs: recipeOutputs,
        inputs: recipeInputs,
        grossRevenue: recipeGross,
        inputCost: recipeInputCost,
        netRevenue: recipeNet,
        inputFulfillment: recipeInputFulfillment,
      })
      // 入力充足率の slotCount 加重和を貯める (正規化は snapshot 組み立て時)。
      assetResult.inputFulfillment += recipeInputFulfillment * rec.slotCount
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
        } else {
          ar.inputFulfillment = 1
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

    // ─── v0.58 §6.3c.5: needSatisfaction (= afford × market-fill) を per-pop で算出し money を burn ───
    //   per-tier 充足 = affordByTier[tier] (買えた割合・money 制約) × marketFill[tier] (市場で満たせた割合)。
    //   afford と market-fill の **積** にすることで「金が無い」も「市場に無い」も両方シグナルに乗る
    //   (placed order の fill だけだと貧困 POP が小口注文を出し市場が埋めれば満足判定になり貧困が消える)。
    //   tier 重み加重平均×100 を平滑化して needSatisfaction。money burn = Σ allocated × marketFill。
    //   burn は smoothedPrice 基準 (allocated と同基準) なので spent ≤ budget で money は負にならない。
    //   unrest 即時加算・wealth 更新はここでは行わない (unrest は needSatisfaction 経由で popSystem が駆動)。
    for (const { popId, needs, affordByTier, allocatedByTier } of market.popDemands) {
      if (needs.length === 0) continue
      const pop = newPopGroups[popId]
      if (!pop) continue
      let weightedFulfill = 0
      let weightSum = 0
      let spent = 0
      for (const tier of TIER_PRIORITY) {
        // placed order の smoothedPrice 評価額で市場充足率 (fulfillmentRatio) を value 加重平均。
        let fillNum = 0
        let fillDen = 0
        for (const cat of needs) {
          if (cat.tier !== tier) continue
          for (const res of cat.resources) {
            const v = res.buyOrders * marketPriceLookup(res.resource) // placed value
            fillNum += v * clamp(fulfillment[res.resource].fulfillmentRatio, 0, 1)
            fillDen += v
          }
        }
        const marketFill = fillDen > 0 ? fillNum / fillDen : 0
        const tierFulfillment = affordByTier[tier] * marketFill // afford × fill
        const w = config.needSatisfactionTierWeight[tier]
        weightedFulfill += tierFulfillment * w
        weightSum += w
        spent += allocatedByTier[tier] * marketFill // 実際に買えた分だけ burn (≤ allocated ≤ budget)
      }
      const instantSat = weightSum > 0 ? (weightedFulfill / weightSum) * 100 : 0
      const a = config.needSatisfactionSmoothing
      const newSat = clamp100(pop.needSatisfaction * (1 - a) + instantSat * a)
      const newMoney = Math.max(0, pop.money - spent)
      newPopGroups[popId] = { ...pop, needSatisfaction: newSat, money: newMoney }
    }
  }

  // ─── v0.58: 賃金 carve ＋ upper 配当 carve (最終 pass) ───
  //   全 market 清算・snapshot 確定後に、各 asset の netRevenue から (1) 賃金 wageShare を lower/middle
  //   雇用 POP へ、(2) 配当 ownerDividendShare を雇用 upper POP へ切り出して money を mint する。
  //   landRevenueSystem は positiveNet = max(0, netRevenue − wageShare − ownerDividendShare) で控除。
  //   タイミング: 今 tick の所得は newPopGroups に積まれ「次 tick から使える」(§3.3 tick 内循環の解消)。
  //   shares は state (start-of-tick・本 system 中不変) を参照、mint 先は newPopGroups。RNG 非消費。
  //   carve==mint 不変条件: 分配不能 (賃金=雇用 PopType 不在 / 配当=雇用 upper 不在) のときは carve せず
  //   owner からも引かない (advisor: owner から carve したのに mint 先がないと money が消える)。
  const wageRate = config.wageShareOfNetRevenue
  const upperDividendRate = config.upperDividendShareOfNetRevenue
  if (wageRate > 0 || upperDividendRate > 0) {
    for (const holdingId of (Object.keys(snapshots) as HoldingId[]).sort()) {
      const snap = snapshots[holdingId]
      if (!snap) continue
      const popIdsHere = state.popIndex.byHolding[holdingId] ?? []

      // ─── 賃金 carve (lower/middle): asset 単位 ───
      //   prodWageByPop に POP 別の生産賃金を記録し、後段の施設俸給 supplement の按分基準に使う。
      const prodWageByPop = new Map<PopGroupId, number>()
      if (wageRate > 0) {
        for (const ar of snap.assetResults) {
          const carveBudget = Math.max(0, ar.netRevenue) * wageRate
          if (carveBudget <= 0) {
            ar.wageShare = 0
            continue
          }
          const asset = state.realEstateAssets[ar.assetId]
          if (!asset) {
            ar.wageShare = 0
            continue
          }
          const shares = computeAssetPopTypeShares(state, asset)
          // 役割重み付きの正規化候補を組む (determinism: PopType key を sorted 反復)。
          let weightSum = 0
          const weighted: { popType: PopType; w: number }[] = []
          for (const t of (Object.keys(shares) as PopType[]).sort()) {
            const s = shares[t] ?? 0
            if (s <= 0) continue
            const w = s * config.wageRoleWeightByRole[WAGE_ROLE_BY_POP_TYPE[t]]
            if (w <= 0) continue
            weighted.push({ popType: t, w })
            weightSum += w
          }
          if (weightSum <= 0) {
            ar.wageShare = 0 // 分配先なし → owner から carve しない
            continue
          }
          // 分配を先に確定し、実際に mint された合計を wageShare とする (carve==mint を構造的に保証)。
          let minted = 0
          for (const { popType, w } of weighted) {
            const amount = carveBudget * (w / weightSum)
            for (const pid of popIdsHere) {
              const pop = newPopGroups[pid]
              if (!pop || pop.popType !== popType || !pop.employed) continue
              newPopGroups[pid] = { ...pop, money: pop.money + amount }
              prodWageByPop.set(pid, (prodWageByPop.get(pid) ?? 0) + amount)
              minted += amount
              break
            }
          }
          ar.wageShare = minted
        }

        // ─── v0.58: 施設(improvement)労働者の俸給 (holding 収入から、施設労働者本人へ) ───
        //   施設は収益を生まないので、施設労働者の給料は holding 収入(owner 取り分)から確保する。
        //   給与水準は同 stratum の生産 per-capita 相当(stratum 単位で「生産賃金総額 × facCap/prodCap」を
        //   施設労働の人件費とし、これは従来総額と同一=owner 影響を変えない)。その人件費を各 stratum の
        //   施設 slot を持つ popType へ facCap 比で按分し、**その popType の雇用 PopGroup 本人**へ mint する
        //   (soldiers 等 生産 asset に登場しない施設専用 popType がここで初めて収入を得る。生産者には mint しない)。
        //   施設 slot が未充足(該当 popType の雇用 POP 不在)なら carve しない(carve==mint)。
        //   prodCap=0 の stratum(upper)は生産賃金ゼロ→対象外(upper は別途配当)。supplement は wageShare に
        //   合算して landRevenue が控除する(施設俸給も労働コスト)。determinism: byHolding/slot/popType は固定順、RNG 非消費。
        if (prodWageByPop.size > 0) {
          const prodCap: Record<PopStratum, number> = { lower: 0, middle: 0, upper: 0 }
          const facCap: Record<PopStratum, number> = { lower: 0, middle: 0, upper: 0 }
          const prodWageByStratum: Record<PopStratum, number> = { lower: 0, middle: 0, upper: 0 }
          for (const aid of state.realEstateAssetIndex.byHolding[holdingId as string] ?? []) {
            const asset = state.realEstateAssets[aid]
            if (!asset) continue
            for (const slot of REAL_ESTATE_DEFINITIONS[asset.realEstateKind].employmentSlots) {
              prodCap[getPopStratum(slot.popType)] += slot.capacityPerLevel * asset.level
            }
          }
          // 施設 slot を popType 別に集計(facCap と、mint 先 popType の列挙基準)。
          const facCapByPopType = new Map<PopType, number>()
          for (const impId of state.holdingImprovementIndex.byHolding[holdingId as string] ?? []) {
            const imp = state.holdingImprovements[impId]
            if (!imp) continue
            const slots = IMPROVEMENT_DEFINITIONS[imp.kind].employmentSlots
            if (!slots) continue
            for (const slot of slots) {
              const cap = slot.capacityPerLevel * imp.level
              facCap[getPopStratum(slot.popType)] += cap
              facCapByPopType.set(slot.popType, (facCapByPopType.get(slot.popType) ?? 0) + cap)
            }
          }
          for (const [pid, prodWage] of prodWageByPop) {
            const pop = newPopGroups[pid]
            if (!pop) continue
            prodWageByStratum[pop.class] += prodWage
          }
          // stratum 別の施設人件費総額 = 生産賃金総額 × facCap_s/prodCap_s(従来総額と同一)。
          const supplementByStratum: Record<PopStratum, number> = { lower: 0, middle: 0, upper: 0 }
          for (const s of ['lower', 'middle', 'upper'] as PopStratum[]) {
            const pc = prodCap[s]
            const fc = facCap[s]
            if (pc <= 0 || fc <= 0) continue
            supplementByStratum[s] = prodWageByStratum[s] * (fc / pc)
          }
          // 各施設 popType へ facCap 比で按分し、その popType の雇用 PopGroup 本人へ mint。
          let supplementTotal = 0
          for (const popType of [...facCapByPopType.keys()].sort()) {
            const cap = facCapByPopType.get(popType) ?? 0
            if (cap <= 0) continue
            const s = getPopStratum(popType)
            const stratumFacCap = facCap[s]
            const stratumBudget = supplementByStratum[s]
            if (stratumFacCap <= 0 || stratumBudget <= 0) continue
            const pay = stratumBudget * (cap / stratumFacCap)
            if (pay <= 0) continue
            for (const pid of popIdsHere) {
              const pop = newPopGroups[pid]
              if (!pop || pop.popType !== popType || !pop.employed) continue
              newPopGroups[pid] = { ...pop, money: pop.money + pay }
              supplementTotal += pay
              break
            }
          }
          // supplement 総額を asset へ max(0,netRevenue) 比で按分し wageShare に加算(landRevenue 控除)。
          if (supplementTotal > 0) {
            let netSum = 0
            for (const ar of snap.assetResults) netSum += Math.max(0, ar.netRevenue)
            if (netSum > 0) {
              for (const ar of snap.assetResults) {
                ar.wageShare += supplementTotal * (Math.max(0, ar.netRevenue) / netSum)
              }
            }
          }
        }
      }

      // ─── v0.58 balance: upper 配当 carve (holding 単位) ───
      //   雇用枠に就いている upper(nobles/patricians) POP に、holding 純収益の固定割合を size 比例で配当。
      //   失業 upper は受け取らない (没落→money 枯渇→既存降格で下位転落)。雇用 upper 不在なら carve しない
      //   (carve==mint: owner から引いて mint 先が無いと money が消えるため)。賃金とは別 carve。
      if (upperDividendRate > 0) {
        // holding 内の雇用 upper POP と総 size を集計 (determinism: byHolding 配列の固定順)。
        let upperSize = 0
        for (const pid of popIdsHere) {
          const pop = newPopGroups[pid]
          if (pop && pop.employed && pop.class === 'upper') upperSize += pop.size
        }
        if (upperSize > 0) {
          // 配当原資 = Σ_assets max(0, netRevenue) × rate。各 asset の ownerDividendShare に記録 (landRevenue 控除)。
          let dividendBudget = 0
          for (const ar of snap.assetResults) {
            const share = Math.max(0, ar.netRevenue) * upperDividendRate
            ar.ownerDividendShare = share
            dividendBudget += share
          }
          if (dividendBudget > 0) {
            for (const pid of popIdsHere) {
              const pop = newPopGroups[pid]
              if (!pop || !pop.employed || pop.class !== 'upper') continue
              const amount = dividendBudget * (pop.size / upperSize)
              newPopGroups[pid] = { ...pop, money: pop.money + amount }
            }
          }
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
