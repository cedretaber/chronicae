import type { ProductionRecipeId } from '../types/ids'
import type { ResourceKind } from '../types/resource'
import type { RealEstateKind } from '../types/realEstateAsset'
import type { PopType } from '../types/popGroup'
import type { InputCategory } from '../types/inputCategory'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'

// §8.1 / §14: recipe の理想労働構成 (soft modifier, hard gate ではない / §14.1)。
export type RecipeLaborRole =
  | 'primary_producer'
  | 'supervisor'
  | 'administrative_support'
  | 'auxiliary_labor'

export type RecipeLaborDemand = {
  popType: PopType
  role: RecipeLaborRole
  idealWeight: number
  directOutputPower?: number // §14.3 (v0.55 簡約形では未使用)
  inputEfficiencyBonus?: number // §14.3 admin role の input 軽減
  throughputBonus?: number // §14.4 将来用 metadata (未使用)
  maxRatioTo?: { popType: PopType; ratio: number } // §14.4 将来用 metadata (hard enforce しない)
}

// §8.1 ProductionRecipe: 不動産が採用する生産レシピ。
//   生産内容は RealEstateKind ではなく recipe に持たせる (RealEstateKind は粗い分類 §7)。
//   inputs は InputCategory 参照 (§6)、outputs/inputs は配列形。
//   laborDemand (§14) は Phase 5 で型ごと追加する。
//   係数は §8.7 の暫定値 (バランス確定値ではなく加工品が原理的に成立するかの検算用)。
export type RecipeInputRequirement = {
  category: InputCategory
  amountPerOutput: number
}

export type RecipeOutputDefinition = {
  resource: ResourceKind
  amount: number
}

export type ProductionRecipe = {
  id: ProductionRecipeId
  allowedRealEstateKinds: RealEstateKind[]
  inputs?: RecipeInputRequirement[]
  outputs: RecipeOutputDefinition[]
  // 労働あたり産出 (§11.1 recipeLabor 方式)。slot は配分比率であり生産量乗数ではない。
  baseOutputPerLabor: number
  // 規模の経済 (§10): config フィールドは maxMultiplierAtFullSlots を維持 (M12)。
  scaleEconomy?: {
    maxMultiplierAtFullSlots: number
  }
  // §8.1 将来用 (v0.55 では型のみ・enforce しない / M11)。
  allowedTerrains?: ProvinceTerrain[]
  allowedFeatures?: ProvinceFeature[]
  terrainOutputModifier?: Partial<Record<ProvinceTerrain, number>>
}

// §8 固定 recipe id。
const GRAIN_FIELD = 'grain_field' as ProductionRecipeId
const FLAX_FIELD = 'flax_field' as ProductionRecipeId
const SHEEP_PASTURE = 'sheep_pasture' as ProductionRecipeId
const CATTLE_PASTURE = 'cattle_pasture' as ProductionRecipeId
const ORCHARD = 'orchard' as ProductionRecipeId
const VINEYARD = 'vineyard' as ProductionRecipeId
const DYE_GARDEN = 'dye_garden' as ProductionRecipeId
const FISHING_HUT = 'fishing_hut' as ProductionRecipeId
const FARM_BREWERY = 'farm_brewery' as ProductionRecipeId
const FARM_WEAVING_SHED = 'farm_weaving_shed' as ProductionRecipeId

const IRON_MINE = 'iron_mine' as ProductionRecipeId
const GEM_MINE = 'gem_mine' as ProductionRecipeId
const QUARRY = 'quarry' as ProductionRecipeId

const LOGGING_HUT = 'logging_hut' as ProductionRecipeId
const HUNTING_LODGE = 'hunting_lodge' as ProductionRecipeId

const URBAN_BREWERY = 'urban_brewery' as ProductionRecipeId
const TEXTILE_WORKSHOP = 'textile_workshop' as ProductionRecipeId
const TAILOR = 'tailor' as ProductionRecipeId
const LUXURY_TAILOR = 'luxury_tailor' as ProductionRecipeId
const TOOL_WORKSHOP = 'tool_workshop' as ProductionRecipeId
const JEWELER_WORKSHOP = 'jeweler_workshop' as ProductionRecipeId
const SMOKEHOUSE = 'smokehouse' as ProductionRecipeId
const BUTCHER_WORKSHOP = 'butcher_workshop' as ProductionRecipeId

const SCALE_2X = { maxMultiplierAtFullSlots: 2.0 }

export const PRODUCTION_RECIPE_DEFINITIONS: Record<ProductionRecipeId, ProductionRecipe> = {
  // ── farm ──
  [GRAIN_FIELD]: {
    id: GRAIN_FIELD,
    allowedRealEstateKinds: ['farm'],
    outputs: [{ resource: 'grain', amount: 1.0 }],
    baseOutputPerLabor: 1.0,
    scaleEconomy: SCALE_2X,
  },
  [FLAX_FIELD]: {
    id: FLAX_FIELD,
    allowedRealEstateKinds: ['farm'],
    outputs: [{ resource: 'flax', amount: 1.0 }],
    baseOutputPerLabor: 0.75,
    scaleEconomy: SCALE_2X,
  },
  [SHEEP_PASTURE]: {
    id: SHEEP_PASTURE,
    allowedRealEstateKinds: ['farm'],
    outputs: [
      { resource: 'wool', amount: 0.8 },
      { resource: 'meat', amount: 0.25 },
    ],
    baseOutputPerLabor: 0.55,
    scaleEconomy: SCALE_2X,
  },
  [CATTLE_PASTURE]: {
    id: CATTLE_PASTURE,
    allowedRealEstateKinds: ['farm'],
    outputs: [{ resource: 'meat', amount: 1.0 }],
    baseOutputPerLabor: 0.6,
    scaleEconomy: SCALE_2X,
  },
  [ORCHARD]: {
    id: ORCHARD,
    allowedRealEstateKinds: ['farm'],
    outputs: [{ resource: 'fruit', amount: 1.0 }],
    baseOutputPerLabor: 0.45,
    scaleEconomy: SCALE_2X,
  },
  [VINEYARD]: {
    id: VINEYARD,
    allowedRealEstateKinds: ['farm'],
    outputs: [{ resource: 'wine', amount: 1.0 }],
    baseOutputPerLabor: 0.35,
    scaleEconomy: SCALE_2X,
  },
  [DYE_GARDEN]: {
    id: DYE_GARDEN,
    allowedRealEstateKinds: ['farm'],
    outputs: [{ resource: 'dye', amount: 1.0 }],
    baseOutputPerLabor: 0.4,
    scaleEconomy: SCALE_2X,
  },
  [FISHING_HUT]: {
    id: FISHING_HUT,
    allowedRealEstateKinds: ['farm'],
    outputs: [{ resource: 'fish', amount: 1.0 }],
    baseOutputPerLabor: 0.75,
    scaleEconomy: SCALE_2X,
  },
  // 農村自家醸造。低効率 (都市 urban_brewery 比)。
  [FARM_BREWERY]: {
    id: FARM_BREWERY,
    allowedRealEstateKinds: ['farm'],
    inputs: [{ category: 'brewing_grain', amountPerOutput: 0.8 }],
    outputs: [{ resource: 'beer', amount: 1.0 }],
    baseOutputPerLabor: 0.5,
    scaleEconomy: SCALE_2X,
  },
  // 農村家内制織物。低効率・高 input。
  [FARM_WEAVING_SHED]: {
    id: FARM_WEAVING_SHED,
    allowedRealEstateKinds: ['farm'],
    inputs: [{ category: 'textile_fiber', amountPerOutput: 1.15 }],
    outputs: [{ resource: 'fabric', amount: 1.0 }],
    baseOutputPerLabor: 0.45,
    scaleEconomy: SCALE_2X,
  },
  // ── mountain ──
  [IRON_MINE]: {
    id: IRON_MINE,
    allowedRealEstateKinds: ['mountain'],
    outputs: [{ resource: 'iron_ore', amount: 1.0 }],
    baseOutputPerLabor: 0.55,
    scaleEconomy: SCALE_2X,
  },
  [GEM_MINE]: {
    id: GEM_MINE,
    allowedRealEstateKinds: ['mountain'],
    outputs: [{ resource: 'gems', amount: 1.0 }],
    baseOutputPerLabor: 0.15,
    scaleEconomy: SCALE_2X,
  },
  [QUARRY]: {
    id: QUARRY,
    allowedRealEstateKinds: ['mountain'],
    outputs: [{ resource: 'stone', amount: 1.0 }],
    baseOutputPerLabor: 0.8,
    scaleEconomy: SCALE_2X,
  },
  // ── woodland ──
  [LOGGING_HUT]: {
    id: LOGGING_HUT,
    allowedRealEstateKinds: ['woodland'],
    outputs: [{ resource: 'timber', amount: 1.0 }],
    baseOutputPerLabor: 0.8,
    scaleEconomy: SCALE_2X,
  },
  // 毛皮を主産物、肉を副産物とする。
  [HUNTING_LODGE]: {
    id: HUNTING_LODGE,
    allowedRealEstateKinds: ['woodland'],
    outputs: [
      { resource: 'fur', amount: 0.4 },
      { resource: 'meat', amount: 0.3 },
    ],
    baseOutputPerLabor: 0.5,
    scaleEconomy: SCALE_2X,
  },
  // ── workshop (level 1: 一次加工 / level 2: clothes・luxury_clothes) ──
  [URBAN_BREWERY]: {
    id: URBAN_BREWERY,
    allowedRealEstateKinds: ['workshop'],
    inputs: [{ category: 'brewing_grain', amountPerOutput: 0.65 }],
    outputs: [{ resource: 'beer', amount: 1.0 }],
    baseOutputPerLabor: 1.1,
    scaleEconomy: SCALE_2X,
  },
  [TEXTILE_WORKSHOP]: {
    id: TEXTILE_WORKSHOP,
    allowedRealEstateKinds: ['workshop'],
    inputs: [{ category: 'textile_fiber', amountPerOutput: 0.9 }],
    outputs: [{ resource: 'fabric', amount: 1.0 }],
    baseOutputPerLabor: 1.05,
    scaleEconomy: SCALE_2X,
  },
  [TAILOR]: {
    id: TAILOR,
    allowedRealEstateKinds: ['workshop'],
    inputs: [{ category: 'fabric', amountPerOutput: 0.65 }],
    outputs: [{ resource: 'clothes', amount: 1.0 }],
    baseOutputPerLabor: 0.85,
    scaleEconomy: SCALE_2X,
  },
  [LUXURY_TAILOR]: {
    id: LUXURY_TAILOR,
    allowedRealEstateKinds: ['workshop'],
    inputs: [
      { category: 'fabric', amountPerOutput: 0.7 },
      { category: 'dye_material', amountPerOutput: 0.4 },
      { category: 'luxury_trim', amountPerOutput: 0.4 },
    ],
    outputs: [{ resource: 'luxury_clothes', amount: 1.0 }],
    baseOutputPerLabor: 0.35,
    scaleEconomy: SCALE_2X,
  },
  // v0.55 では metal=iron_ore / construction_wood=timber。
  [TOOL_WORKSHOP]: {
    id: TOOL_WORKSHOP,
    allowedRealEstateKinds: ['workshop'],
    inputs: [
      { category: 'metal', amountPerOutput: 0.5 },
      { category: 'construction_wood', amountPerOutput: 0.5 },
    ],
    outputs: [{ resource: 'tools', amount: 1.0 }],
    baseOutputPerLabor: 0.6,
    scaleEconomy: SCALE_2X,
  },
  [JEWELER_WORKSHOP]: {
    id: JEWELER_WORKSHOP,
    allowedRealEstateKinds: ['workshop'],
    inputs: [{ category: 'gems', amountPerOutput: 0.5 }],
    outputs: [{ resource: 'jewelry', amount: 1.0 }],
    baseOutputPerLabor: 0.25,
    scaleEconomy: SCALE_2X,
  },
  // 燻製燃料・加工材として construction_wood を要求する。
  [SMOKEHOUSE]: {
    id: SMOKEHOUSE,
    allowedRealEstateKinds: ['workshop'],
    inputs: [
      { category: 'raw_fish', amountPerOutput: 0.7 },
      { category: 'construction_wood', amountPerOutput: 0.2 },
    ],
    outputs: [{ resource: 'smoked_fish', amount: 1.0 }],
    baseOutputPerLabor: 0.75,
    scaleEconomy: SCALE_2X,
  },
  [BUTCHER_WORKSHOP]: {
    id: BUTCHER_WORKSHOP,
    allowedRealEstateKinds: ['workshop'],
    inputs: [{ category: 'raw_meat', amountPerOutput: 0.75 }],
    outputs: [{ resource: 'processed_meat', amount: 1.0 }],
    baseOutputPerLabor: 0.75,
    scaleEconomy: SCALE_2X,
  },
}

// §9 DefaultRecipeSlotProfile: RealEstateKind ごとの初期 recipe weight (比率)。
//   実際の整数 slot は config.realEstateRecipeSlotCount から largest-remainder で決定論的に計算する。
const DEFAULT_RECIPE_WEIGHTS_BY_KIND: Record<
  RealEstateKind,
  { recipeId: ProductionRecipeId; weight: number }[]
> = {
  farm: [
    { recipeId: GRAIN_FIELD, weight: 6 },
    { recipeId: FLAX_FIELD, weight: 2 },
    { recipeId: SHEEP_PASTURE, weight: 3 },
    { recipeId: CATTLE_PASTURE, weight: 3 },
    { recipeId: ORCHARD, weight: 1 },
    { recipeId: VINEYARD, weight: 1 },
    { recipeId: DYE_GARDEN, weight: 1 },
    { recipeId: FISHING_HUT, weight: 1 },
    { recipeId: FARM_BREWERY, weight: 2 },
    { recipeId: FARM_WEAVING_SHED, weight: 2 },
  ],
  mountain: [
    { recipeId: IRON_MINE, weight: 4 },
    { recipeId: GEM_MINE, weight: 1 },
    { recipeId: QUARRY, weight: 5 },
  ],
  woodland: [
    { recipeId: LOGGING_HUT, weight: 6 },
    { recipeId: HUNTING_LODGE, weight: 4 },
  ],
  workshop: [
    { recipeId: URBAN_BREWERY, weight: 2 },
    { recipeId: TEXTILE_WORKSHOP, weight: 3 },
    { recipeId: TAILOR, weight: 3 },
    { recipeId: LUXURY_TAILOR, weight: 1 },
    { recipeId: TOOL_WORKSHOP, weight: 3 },
    { recipeId: JEWELER_WORKSHOP, weight: 1 },
    { recipeId: SMOKEHOUSE, weight: 2 },
    { recipeId: BUTCHER_WORKSHOP, weight: 2 },
  ],
}

// weight に比例して slotCount を整数配分する (largest-remainder, determinism)。
//   合計が必ず slotCount と一致する (§9.1)。
function distributeSlots(
  weights: { recipeId: ProductionRecipeId; weight: number }[],
  slotCount: number,
): Partial<Record<ProductionRecipeId, number>> {
  const totalWeight = weights.reduce((acc, w) => acc + w.weight, 0)
  if (totalWeight <= 0 || weights.length === 0) return {}
  const floored = weights.map((w) => {
    const exact = (w.weight / totalWeight) * slotCount
    const slots = Math.floor(exact)
    return { recipeId: w.recipeId, slots, frac: exact - slots }
  })
  const assigned = floored.reduce((acc, f) => acc + f.slots, 0)
  let remainder = slotCount - assigned
  // 端数の大きい順に 1 slot ずつ配る (tiebreak は recipeId sorted で決定的)。
  const order = [...floored].sort((a, b) => b.frac - a.frac || (a.recipeId < b.recipeId ? -1 : 1))
  for (const o of order) {
    if (remainder <= 0) break
    o.slots += 1
    remainder -= 1
  }
  const result: Partial<Record<ProductionRecipeId, number>> = {}
  for (const f of floored) {
    if (f.slots > 0) result[f.recipeId] = f.slots
  }
  return result
}

export function getDefaultRecipeSlotsForRealEstateKind(
  kind: RealEstateKind,
  slotCount = 20,
): Partial<Record<ProductionRecipeId, number>> {
  return distributeSlots(DEFAULT_RECIPE_WEIGHTS_BY_KIND[kind], slotCount)
}

// §14.2 / §14.3: recipe ごとの理想労働構成。spec は workshop 例のみ提示のため、recipe の性質
//   (一次生産 / 農村加工 / 都市工房) ごとに §13.2 PopType 分類と整合する profile を割り当てる。
//   v0.55 では soft modifier (floor 0.70) なので構成ズレは効率低下に留まる。
const FARM_FIELD_LABOR: RecipeLaborDemand[] = [
  { popType: 'peasants', role: 'primary_producer', idealWeight: 3, directOutputPower: 1.0 },
  { popType: 'freeholders', role: 'supervisor', idealWeight: 1, directOutputPower: 1.3 },
]
const FARM_CRAFT_LABOR: RecipeLaborDemand[] = [
  { popType: 'peasants', role: 'primary_producer', idealWeight: 3, directOutputPower: 1.0 },
  { popType: 'artisans', role: 'supervisor', idealWeight: 1, directOutputPower: 1.2 },
]
const EXTRACTION_LABOR: RecipeLaborDemand[] = [
  { popType: 'laborers', role: 'primary_producer', idealWeight: 3, directOutputPower: 1.0 },
  { popType: 'freeholders', role: 'supervisor', idealWeight: 1, directOutputPower: 1.3 },
]
const WORKSHOP_LABOR: RecipeLaborDemand[] = [
  { popType: 'artisans', role: 'primary_producer', idealWeight: 3, directOutputPower: 1.0 },
  {
    popType: 'masters',
    role: 'supervisor',
    idealWeight: 1,
    directOutputPower: 1.5,
    maxRatioTo: { popType: 'artisans', ratio: 1 / 3 },
  },
  {
    popType: 'scribes',
    role: 'administrative_support',
    idealWeight: 1,
    inputEfficiencyBonus: 0.1,
    maxRatioTo: { popType: 'artisans', ratio: 1 / 3 },
  },
]

export const RECIPE_LABOR_PROFILES: Record<ProductionRecipeId, RecipeLaborDemand[]> = {
  [GRAIN_FIELD]: FARM_FIELD_LABOR,
  [FLAX_FIELD]: FARM_FIELD_LABOR,
  [SHEEP_PASTURE]: FARM_FIELD_LABOR,
  [CATTLE_PASTURE]: FARM_FIELD_LABOR,
  [ORCHARD]: FARM_FIELD_LABOR,
  [VINEYARD]: FARM_FIELD_LABOR,
  [DYE_GARDEN]: FARM_FIELD_LABOR,
  [FISHING_HUT]: FARM_FIELD_LABOR,
  [FARM_BREWERY]: FARM_CRAFT_LABOR,
  [FARM_WEAVING_SHED]: FARM_CRAFT_LABOR,
  [IRON_MINE]: EXTRACTION_LABOR,
  [GEM_MINE]: EXTRACTION_LABOR,
  [QUARRY]: EXTRACTION_LABOR,
  [LOGGING_HUT]: EXTRACTION_LABOR,
  [HUNTING_LODGE]: EXTRACTION_LABOR,
  [URBAN_BREWERY]: WORKSHOP_LABOR,
  [TEXTILE_WORKSHOP]: WORKSHOP_LABOR,
  [TAILOR]: WORKSHOP_LABOR,
  [LUXURY_TAILOR]: WORKSHOP_LABOR,
  [TOOL_WORKSHOP]: WORKSHOP_LABOR,
  [JEWELER_WORKSHOP]: WORKSHOP_LABOR,
  [SMOKEHOUSE]: WORKSHOP_LABOR,
  [BUTCHER_WORKSHOP]: WORKSHOP_LABOR,
}
