import type { ResourceKind } from '../types/resource'
import type { NeedCategory } from '../types/needCategory'
import { NEED_CATEGORY_CONTRIBUTIONS } from '../types/needCategory'

// v0.55 POP 再設計: carrying capacity の「食料」= staple_food/protein/fine_food カテゴリの寄与資源。
//   各資源の food value = それら food カテゴリにおける contribution 値の合計。
//   NEED_CATEGORY_CONTRIBUTIONS から導出し、需要定義との drift を防ぐ (basic_drink 等は食料に含めない)。
const FOOD_NEED_CATEGORIES: NeedCategory[] = ['staple_food', 'protein', 'fine_food']

function buildFoodResourceValue(): Partial<Record<ResourceKind, number>> {
  const out: Partial<Record<ResourceKind, number>> = {}
  for (const cat of FOOD_NEED_CATEGORIES) {
    const contrib = NEED_CATEGORY_CONTRIBUTIONS[cat]
    for (const [resource, value] of Object.entries(contrib) as [ResourceKind, number][]) {
      out[resource] = (out[resource] ?? 0) + value
    }
  }
  return out
}

export const FOOD_RESOURCE_VALUE: Partial<Record<ResourceKind, number>> = buildFoodResourceValue()
