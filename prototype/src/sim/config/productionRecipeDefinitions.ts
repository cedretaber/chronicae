import type { ProductionRecipeId } from '../types/ids'
import type { ResourceKind } from '../types/resource'
import type { RealEstateKind } from '../types/realEstateAsset'

// §7.3 ProductionRecipe: 不動産が採用する生産レシピ。
//   生産内容は RealEstateKind ではなく recipe に持たせる (RealEstateKind は粗い分類 §7)。
//   v0.55 Phase 1 では DAG 清算を実際に通すための最小 recipe セット。
//   InputCategory / RecipeLaborDemand / 全 recipe カタログは Phase 2 以降で導入する。
export type ProductionRecipe = {
  id: ProductionRecipeId
  allowedRealEstateKinds: RealEstateKind[]
  outputs: Partial<Record<ResourceKind, number>>
  inputs?: Partial<Record<ResourceKind, number>>
  // 労働あたり産出 (§11.1 recipeLabor 方式)。slot は配分比率であり生産量乗数ではない。
  baseOutputPerLabor: number
  // 規模の経済 (§10): 同 asset 内で同 recipe を多く採用するほど slot あたり生産性が上がる。
  scaleEconomy?: {
    maxMultiplierAtFullSlots: number
  }
}

// v0.55 Phase 1 固定 recipe id。
const GRAIN_FIELD = 'grain_field' as ProductionRecipeId
const LOGGING_HUT = 'logging_hut' as ProductionRecipeId
const QUARRY = 'quarry' as ProductionRecipeId
const IRON_MINE = 'iron_mine' as ProductionRecipeId
const WORKSHOP_BREWERY = 'workshop_brewery' as ProductionRecipeId
const TOOL_WORKSHOP = 'tool_workshop' as ProductionRecipeId

export const PRODUCTION_RECIPE_DEFINITIONS: Record<ProductionRecipeId, ProductionRecipe> = {
  // ── level 0 (raw) ──
  [GRAIN_FIELD]: {
    id: GRAIN_FIELD,
    allowedRealEstateKinds: ['farm'],
    outputs: { grain: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
  [LOGGING_HUT]: {
    id: LOGGING_HUT,
    allowedRealEstateKinds: ['woodland'],
    outputs: { timber: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
  [QUARRY]: {
    id: QUARRY,
    allowedRealEstateKinds: ['mountain'],
    outputs: { stone: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
  [IRON_MINE]: {
    id: IRON_MINE,
    allowedRealEstateKinds: ['mountain'],
    outputs: { iron_ore: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
  // ── level 1 (加工) ──
  // dual-use grain 検証: grain は POP staple 需要 + brewery input 需要を持つ。
  [WORKSHOP_BREWERY]: {
    id: WORKSHOP_BREWERY,
    allowedRealEstateKinds: ['workshop'],
    inputs: { grain: 1.0 },
    outputs: { beer: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
  // 複数 input 検証 (Liebig 最小律 §12.4): iron_ore + timber -> tools。
  [TOOL_WORKSHOP]: {
    id: TOOL_WORKSHOP,
    allowedRealEstateKinds: ['workshop'],
    inputs: { iron_ore: 1.0, timber: 1.0 },
    outputs: { tools: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
}

// v0.55 Phase 1: RealEstateKind ごとの既定 recipeSlots。各 asset は 20 slot を主 recipe へ配分する。
//   slotCount は config.realEstateRecipeSlotCount と一致させる (integrity §21.1 で検査)。
//   Phase 2 で DefaultRecipeSlotProfile (比率 + largest-remainder) へ置換する。
const DEFAULT_RECIPE_WEIGHTS_BY_KIND: Record<
  RealEstateKind,
  { recipeId: ProductionRecipeId; weight: number }[]
> = {
  farm: [{ recipeId: GRAIN_FIELD, weight: 1 }],
  mountain: [
    { recipeId: QUARRY, weight: 1 },
    { recipeId: IRON_MINE, weight: 1 },
  ],
  woodland: [{ recipeId: LOGGING_HUT, weight: 1 }],
  workshop: [
    { recipeId: TOOL_WORKSHOP, weight: 1 },
    { recipeId: WORKSHOP_BREWERY, weight: 1 },
  ],
}

// weight に比例して slotCount を整数配分する (largest-remainder, determinism)。
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
