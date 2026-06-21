import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId, ProductionRecipeId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { ResourceKind } from '../types/resource'
import type { InputCategory } from '../types/inputCategory'
import { INPUT_CATEGORY_CONTRIBUTIONS } from '../types/inputCategory'
import { REAL_ESTATE_DEFINITIONS } from '../config/realEstateDefinitions'
import { PRODUCTION_RECIPE_DEFINITIONS } from '../config/productionRecipeDefinitions'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import {
  computeAssetSlotCapacityTerm,
  computeSlotOveruseModifier,
} from './holdingImprovementSelectors'
import { getHoldingEmployedPopSize, getHoldingClassCapacity } from './popSelectors'
import { resolveCategoryShares } from './resourceChoiceSelectors'
import { clamp } from '../utils/math'

// v0.54 §9 規模の経済: 同 asset 内で同 recipe を多く採用するほど slot あたり生産性が上がる。
function getRecipeScaleMultiplier(
  slotCountForRecipe: number,
  totalSlots: number,
  maxMultiplierAtFullSlots: number,
): number {
  if (slotCountForRecipe <= 0) return 0
  if (totalSlots <= 1) return 1.0
  const scaleBonusAtFull = maxMultiplierAtFullSlots - 1.0
  return 1.0 + scaleBonusAtFull * ((slotCountForRecipe - 1) / (totalSlots - 1))
}

// v0.54 §12.3 polityControlModifier: control 0 でも min、control 100 で 1.0。
function computePolityControlModifier(polityControl: number, config: SimulationConfig): number {
  const min = config.resourceEconomyControlModifierMin
  return clamp(min + (polityControl / 100) * (1 - min), min, 1.0)
}

// v0.54 §11.4 staffingFulfillment: 施設を運用する人員の充足率 proxy。
//   degeneration-avoidance pass では holding-level の class 別 employed/capacity を proxy とする (§11.4 簡易案)。
function computeStaffingFulfillment(used: number, capacity: number): number {
  if (capacity <= 0) return 1.0
  return clamp(used / capacity, 0, 1)
}

// v0.54 §10.2 / §23 Step 2: per-asset の class capacity 寄与。
//   既存 computeHoldingClassCapacity の asset_term を単一 asset について計算したもの
//   (holding 共通の overuseMod / landQuality / weight も掛けて faithful な capacity 値にする)。
//   labor 按分の weight に使う (holding 共通項は比率で相殺するため weight としては asset 固有項だけでも足りる)。
function getRealEstateAssetClassCapacityContribution(
  state: WorldState,
  asset: RealEstateAsset,
  popClass: PopClass,
  config: SimulationConfig,
): number {
  const holding = state.holdings[asset.holdingId]
  if (!holding) return 0
  const province = state.provinces[holding.provinceId]
  if (!province) return 0

  const improvements: { kind: HoldingImprovementKind; level: number; condition: number }[] = []
  const improvementIds = state.holdingImprovementIndex.byHolding[asset.holdingId as string] ?? []
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (imp) improvements.push({ kind: imp.kind, level: imp.level, condition: imp.condition })
  }
  const assetTerm = computeAssetSlotCapacityTerm(
    asset.realEstateKind,
    asset.level,
    popClass,
    province.terrain,
    province.features,
    improvements,
    config,
  )

  // overuseMod / landQuality / weight は holding 共通項 (computeHoldingClassCapacity と同じ)。
  const usedSlots = (state.realEstateAssetIndex.byHolding[asset.holdingId as string] ?? []).length
  const slotCap = config.realEstateSlotCapacityBase[holding.kind] ?? 3
  const overuseMod = computeSlotOveruseModifier(usedSlots, slotCap, config)
  return assetTerm * overuseMod * holding.landQuality * holding.weight
}

// v0.54 §11.2 生産施設 modifier。
//   facilityModifier = 1.0 + Σ bonusPerLevel * level * conditionFactor * staffingFulfillment。
//   施設ボーナス部分だけを condition/staffing で減衰させ、基礎生産性 (1.0) には掛けない (§11.2)。
//   staffingFulfillment は asset の主要雇用 class の holding-level 充足率 proxy (§11.4 簡易案)。
function computeProductionFacilityModifier(
  state: WorldState,
  config: SimulationConfig,
  asset: RealEstateAsset,
): number {
  const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
  const primaryClass = def.employmentSlots[0]?.popClass
  const modDefs = config.realEstateProductionFacilityModifiers[asset.realEstateKind]
  if (modDefs.length === 0) return 1.0

  // 主要雇用 class の holding-level staffing proxy (§11.4)。
  let staffing = 1.0
  if (primaryClass) {
    const used = getHoldingEmployedPopSize(state, asset.holdingId, primaryClass)
    const capacity = getHoldingClassCapacity(state, config, asset.holdingId, primaryClass)
    staffing = computeStaffingFulfillment(used, capacity)
  }

  const improvementIds = state.holdingImprovementIndex.byHolding[asset.holdingId as string] ?? []
  let modifier = 1.0
  for (const modDef of modDefs) {
    for (const impId of improvementIds) {
      const imp = state.holdingImprovements[impId]
      if (!imp || imp.kind !== modDef.improvementKind) continue
      const conditionFactor = imp.condition / 100 // §11.3 linear
      modifier += modDef.bonusPerLevel * imp.level * conditionFactor * staffing
    }
  }
  return modifier
}

// v0.54 §10.2: holding 内の asset を主要雇用 class 別に分け、employed POP size を per-asset capacity 比で
//   按分する。Σ allocatedLabor (class) == employed POP size (class) を保つ (labor conservation)。
//   受け皿 asset が無い class の労働は遊休 (生産に使わない)。RNG 非消費・純関数。
export function computeAllocatedLaborByAsset(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  assets: RealEstateAsset[],
): Map<string, number> {
  const result = new Map<string, number>()
  const classes: PopClass[] = ['nobles', 'peasants', 'townsmen']
  for (const popClass of classes) {
    const employed = getHoldingEmployedPopSize(state, holdingId, popClass)
    if (employed <= 0) continue
    const members: { asset: RealEstateAsset; weight: number }[] = []
    let totalWeight = 0
    for (const asset of assets) {
      const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
      if (def.employmentSlots[0]?.popClass !== popClass) continue
      const weight = getRealEstateAssetClassCapacityContribution(state, asset, popClass, config)
      members.push({ asset, weight })
      totalWeight += weight
    }
    if (totalWeight <= 0) continue
    for (const m of members) {
      const prev = result.get(m.asset.id) ?? 0
      result.set(m.asset.id, prev + employed * (m.weight / totalWeight))
    }
  }
  return result
}

// v0.54 §12.1: asset の recipe ごとの potential 産出/投入を計算する (市場 clearing 前の潜在値)。
//   recipeLabor = allocatedLabor * (slotCount / totalSlots)。recipeSlots は sorted key 順 (determinism)。
//   ResourceEconomySystem (市場 clearing) と fallback selector (potential×basePrice) の双方が使う。
// §6.3: input category を ResourceKind buyOrders へ解決した結果 (category-Liebig / pro-rate 用)。
export type ResolvedInputCategory = {
  category: InputCategory
  desiredAmount: number // amountPerOutput × potential (category value 単位)
  resources: { resource: ResourceKind; buyOrders: number; share: number }[]
}

export type AssetRecipePotential = {
  recipeId: ProductionRecipeId
  slotCount: number
  recipeLabor: number
  potentialOutputs: Partial<Record<ResourceKind, number>>
  // category 解決後の resource 別 buyOrders 合算 (demand 集計 / fallback 評価用)。
  potentialInputs: Partial<Record<ResourceKind, number>>
  // category 単位の解決内訳 (§12.4 Liebig / §12.5 pro-rate 用)。
  inputCategories: ResolvedInputCategory[]
}

const basePriceLookup = (r: ResourceKind): number => RESOURCE_PRICE_DEFINITIONS[r].basePrice

export function computeAssetRecipePotentials(
  state: WorldState,
  config: SimulationConfig,
  asset: RealEstateAsset,
  allocatedLabor: number,
  // §6.3 share 解決に使う価格。市場 clearing は smoothedPrice-or-base、fallback は basePrice。
  priceLookup: (resource: ResourceKind) => number = basePriceLookup,
): AssetRecipePotential[] {
  const holding = state.holdings[asset.holdingId]
  if (!holding) return []
  const totalSlots = config.realEstateRecipeSlotCount
  const controlMod = computePolityControlModifier(holding.polityControl, config)
  // v0.54: asset.level は雇用枠 (capacityPerLevel × level、施設サイズ) にのみ効く。
  //   level→労働あたり生産性の結合は撤去 (生産性向上は将来の技術/制度システムに委ねる)。
  const facilityMod = computeProductionFacilityModifier(state, config, asset)
  const beta = config.inputResourceChoiceBeta

  const results: AssetRecipePotential[] = []
  const recipeIds = (Object.keys(asset.recipeSlots) as ProductionRecipeId[]).sort()
  for (const recipeId of recipeIds) {
    const slotCount = asset.recipeSlots[recipeId]
    if (slotCount === undefined || slotCount <= 0) continue
    const recipe = PRODUCTION_RECIPE_DEFINITIONS[recipeId]
    if (!recipe) continue

    const recipeLabor = allocatedLabor * (slotCount / totalSlots)
    const scaleMult = getRecipeScaleMultiplier(
      slotCount,
      totalSlots,
      recipe.scaleEconomy?.maxMultiplierAtFullSlots ?? 1.0,
    )
    const potential = recipeLabor * recipe.baseOutputPerLabor * scaleMult * facilityMod * controlMod

    const potentialOutputs: Partial<Record<ResourceKind, number>> = {}
    for (const o of recipe.outputs) {
      potentialOutputs[o.resource] = (potentialOutputs[o.resource] ?? 0) + potential * o.amount
    }

    // §6.3: 各 input category を満たす ResourceKind へ比率配分し buyOrders へ変換する。
    const potentialInputs: Partial<Record<ResourceKind, number>> = {}
    const inputCategories: ResolvedInputCategory[] = []
    if (recipe.inputs) {
      for (const req of recipe.inputs) {
        const desiredAmount = req.amountPerOutput * potential
        const contributions = INPUT_CATEGORY_CONTRIBUTIONS[req.category]
        const shares = resolveCategoryShares(contributions, priceLookup, beta)
        const resources: { resource: ResourceKind; buyOrders: number; share: number }[] = []
        for (const s of shares) {
          // buyOrders (資源単位) = share × desiredCategoryAmount / contributionValue (§6.3)。
          const buyOrders = (s.share * desiredAmount) / s.contributionValue
          potentialInputs[s.resource] = (potentialInputs[s.resource] ?? 0) + buyOrders
          resources.push({ resource: s.resource, buyOrders, share: s.share })
        }
        inputCategories.push({ category: req.category, desiredAmount, resources })
      }
    }
    results.push({
      recipeId,
      slotCount,
      recipeLabor,
      potentialOutputs,
      potentialInputs,
      inputCategories,
    })
  }
  return results
}
