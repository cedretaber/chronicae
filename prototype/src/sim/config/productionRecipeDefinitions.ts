import type { ProductionRecipeId } from '../types/ids'
import type { ResourceKind } from '../types/resource'
import type { RealEstateKind } from '../types/realEstateAsset'

// v0.54 §7.3 ProductionRecipe: 不動産が採用する生産レシピ。
//   生産内容は RealEstateKind ではなく recipe に持たせる (v0.55 で RealEstateKind を粗い分類へ
//   再編しても recipe 計算を壊さず移行できるようにするため §25)。
export type ProductionRecipe = {
  id: ProductionRecipeId
  allowedRealEstateKinds: RealEstateKind[]
  outputs: Partial<Record<ResourceKind, number>>
  inputs?: Partial<Record<ResourceKind, number>>
  // 労働あたり産出 (§12.1 recipeLabor 方式)。slot は配分比率であり生産量乗数ではない。
  baseOutputPerLabor: number
  // 規模の経済 (§9): 同 asset 内で同 recipe を多く採用するほど slot あたり生産性が上がる。
  scaleEconomy?: {
    maxMultiplierAtFullSlots: number
  }
}

// v0.54 の固定 recipe id (worldgen で連番生成しない literal cast)。
const FIELD_FOOD = 'field_food' as ProductionRecipeId
const PASTURE_RAW_MATERIALS = 'pasture_raw_materials' as ProductionRecipeId
const WORKSHOP_PROCESSED_GOODS = 'workshop_processed_goods' as ProductionRecipeId

export const PRODUCTION_RECIPE_DEFINITIONS: Record<ProductionRecipeId, ProductionRecipe> = {
  [FIELD_FOOD]: {
    id: FIELD_FOOD,
    allowedRealEstateKinds: ['field'],
    outputs: { food: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
  [PASTURE_RAW_MATERIALS]: {
    id: PASTURE_RAW_MATERIALS,
    allowedRealEstateKinds: ['pasture'],
    outputs: { raw_materials: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
  [WORKSHOP_PROCESSED_GOODS]: {
    id: WORKSHOP_PROCESSED_GOODS,
    allowedRealEstateKinds: ['workshop'],
    inputs: { raw_materials: 1.0 },
    outputs: { processed_goods: 1.0 },
    baseOutputPerLabor: 1.0,
    scaleEconomy: { maxMultiplierAtFullSlots: 2.0 },
  },
}

// v0.54 §8.3: RealEstateKind ごとの既定 recipeSlots。各 asset は 20 slot を主 recipe に割り当てる。
//   slotCount は config.realEstateRecipeSlotCount と一致させる (integrity §21.1 で検査)。
const DEFAULT_RECIPE_BY_REAL_ESTATE_KIND: Record<RealEstateKind, ProductionRecipeId> = {
  field: FIELD_FOOD,
  pasture: PASTURE_RAW_MATERIALS,
  workshop: WORKSHOP_PROCESSED_GOODS,
}

export function getDefaultRecipeSlotsForRealEstateKind(
  kind: RealEstateKind,
  slotCount = 20,
): Partial<Record<ProductionRecipeId, number>> {
  return { [DEFAULT_RECIPE_BY_REAL_ESTATE_KIND[kind]]: slotCount }
}
