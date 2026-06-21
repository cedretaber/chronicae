import type { TickContext } from './context'
import type { StateRegionId, ProductionRecipeId } from '../types/ids'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import { getSmoothedPriceOrBase } from '../config/resourceEconomyDefinitions'
import { getAllowedRecipeIdsForKind } from '../config/productionRecipeDefinitions'
import {
  computeAllocatedLaborByAsset,
  computeAssetRecipePotentials,
} from '../selectors/resourceProductionSelectors'

// v0.55 §17 RecipeSwitchSystem: 各 RealEstateAsset は月次で最大 1 slot だけ recipe を入れ替える。
//   ResourceEconomySystem 直後 (最新 smoothedPrice を読み、当月 snapshot を壊さない)。RNG 非消費。
//   best-improvement (§17.3): 全 1-slot 移動を expectedAssetProfit で評価し最大を選ぶ。
//   gain が recipeSwitchMinGainRate を超える場合のみ適用。slot 合計は atomic -1/+1 で保存。

// §17.5 expectedAssetProfit: 候補 recipe の期待利益。computeAssetRecipePotentials を smoothedPrice で
//   再計算し、Σ(output×price) − Σ(input×price) を返す (市場 clearing fulfillment は掛けない)。
function expectedAssetProfit(
  ctx: TickContext,
  asset: RealEstateAsset,
  recipeSlots: Partial<Record<ProductionRecipeId, number>>,
  allocatedLabor: number,
  priceLookup: (r: ResourceKind) => number,
): number {
  const potentials = computeAssetRecipePotentials(
    ctx.state,
    ctx.config,
    { ...asset, recipeSlots },
    allocatedLabor,
    priceLookup,
  )
  let net = 0
  for (const rp of potentials) {
    for (const r of RESOURCE_KINDS) {
      const out = rp.potentialOutputs[r]
      if (out !== undefined) net += out * priceLookup(r)
      const inp = rp.potentialInputs[r]
      if (inp !== undefined) net -= inp * priceLookup(r)
    }
  }
  return net
}

export function runRecipeSwitchSystem(ctx: TickContext): TickContext {
  const { state, config } = ctx
  const minGainRate = config.recipeSwitchMinGainRate
  const stateIds = (Object.keys(state.states) as StateRegionId[]).sort()

  const updatedAssets: Record<string, RealEstateAsset> = {}
  let anyChange = false

  for (const stateId of stateIds) {
    const region = state.states[stateId]
    if (!region) continue
    const marketKey = stateId as string
    const priceLookup = (resource: ResourceKind): number => {
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
        if (assets.length === 0) continue
        const allocatedByAsset = computeAllocatedLaborByAsset(state, config, holdingId, assets)

        for (const asset of assets) {
          const allocatedLabor = allocatedByAsset.get(asset.id) ?? 0
          if (allocatedLabor <= 0) continue
          const allowed = getAllowedRecipeIdsForKind(asset.realEstateKind)
          if (allowed.length <= 1) continue

          const profitBefore = expectedAssetProfit(
            ctx,
            asset,
            asset.recipeSlots,
            allocatedLabor,
            priceLookup,
          )
          const threshold = profitBefore * (1 + minGainRate)

          // 現在 slot を持つ recipe A から、許可 recipe B (≠A) へ 1 slot 移す全 (A,B) を評価する。
          const fromIds = (Object.keys(asset.recipeSlots) as ProductionRecipeId[])
            .filter((id) => (asset.recipeSlots[id] ?? 0) > 0)
            .sort()
          let bestProfit = profitBefore
          let bestSlots: Partial<Record<ProductionRecipeId, number>> | undefined

          for (const a of fromIds) {
            for (const b of allowed) {
              if (b === a) continue
              const slots: Partial<Record<ProductionRecipeId, number>> = { ...asset.recipeSlots }
              const aNext = (slots[a] ?? 0) - 1
              if (aNext <= 0) delete slots[a]
              else slots[a] = aNext
              slots[b] = (slots[b] ?? 0) + 1
              const profit = expectedAssetProfit(ctx, asset, slots, allocatedLabor, priceLookup)
              // 同点は (A,B) 昇順で tiebreak (fromIds / allowed が sorted なので先勝ちで足りる)。
              if (profit > bestProfit) {
                bestProfit = profit
                bestSlots = slots
              }
            }
          }

          if (bestSlots && bestProfit > threshold) {
            updatedAssets[asset.id as string] = { ...asset, recipeSlots: bestSlots }
            anyChange = true
          }
        }
      }
    }
  }

  if (!anyChange) return ctx
  return {
    ...ctx,
    state: {
      ...state,
      realEstateAssets: { ...state.realEstateAssets, ...updatedAssets },
    },
  }
}
