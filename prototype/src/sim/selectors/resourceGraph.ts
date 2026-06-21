import type { ProductionRecipeId } from '../types/ids'
import type { ResourceKind } from '../types/resource'
import { RESOURCE_KINDS } from '../types/resource'
import type { ProductionRecipe } from '../config/productionRecipeDefinitions'
import { PRODUCTION_RECIPE_DEFINITIONS } from '../config/productionRecipeDefinitions'

// v0.55 §12.2 資源依存グラフ: recipe の input/output から resource dependency level を導出する。
//   raw resource (どの recipe の output でもない、または input を持たない recipe の output): level 0
//   recipe output resource: level = 1 + max(level(input resource))
//   同じ resource を複数 recipe が産出する場合は max を取る。
//   この graph は非循環でなければならない (IntegrityCheck §12.2 で cycle を検出)。
//   level は静的 config から定義時に 1 回計算し、毎清算で再計算しない。

export type ResourceLevelResult = {
  levels: Record<ResourceKind, number>
  // cycle が検出された場合、循環に含まれる resource 列 (debug/integrity 用)。無ければ null。
  cycle: ResourceKind[] | null
}

function recipeOutputResources(recipe: ProductionRecipe): ResourceKind[] {
  const result: ResourceKind[] = []
  for (const r of RESOURCE_KINDS) {
    if (recipe.outputs[r] !== undefined) result.push(r)
  }
  return result
}

function recipeInputResources(recipe: ProductionRecipe): ResourceKind[] {
  if (!recipe.inputs) return []
  const result: ResourceKind[] = []
  for (const r of RESOURCE_KINDS) {
    if (recipe.inputs[r] !== undefined) result.push(r)
  }
  return result
}

// recipe の input/output から resource level を計算する。純関数・RNG 非消費。
//   cycle 検出時は cycle 経路を返し levels は (循環を 0 とした) 暫定値を返す。
export function computeResourceLevels(
  recipes: Record<ProductionRecipeId, ProductionRecipe>,
): ResourceLevelResult {
  // resource -> それを産出する recipe 一覧。
  const producersByResource = new Map<ResourceKind, ProductionRecipe[]>()
  const recipeIds = (Object.keys(recipes) as ProductionRecipeId[]).sort()
  for (const recipeId of recipeIds) {
    const recipe = recipes[recipeId]
    if (!recipe) continue
    for (const r of recipeOutputResources(recipe)) {
      const arr = producersByResource.get(r) ?? []
      arr.push(recipe)
      producersByResource.set(r, arr)
    }
  }

  const levels: Partial<Record<ResourceKind, number>> = {}
  const color = new Map<ResourceKind, 'gray' | 'black'>()
  let cycle: ResourceKind[] | null = null

  function visit(r: ResourceKind, stack: ResourceKind[]): number {
    const c = color.get(r)
    if (c === 'black') return levels[r] ?? 0
    if (c === 'gray') {
      if (!cycle) cycle = [...stack, r]
      return 0
    }
    color.set(r, 'gray')
    let lvl = 0
    const producers = producersByResource.get(r) ?? []
    for (const recipe of producers) {
      const inputKeys = recipeInputResources(recipe)
      if (inputKeys.length === 0) continue // raw 産出 (level 0 候補)
      let maxInput = 0
      for (const ik of inputKeys) {
        maxInput = Math.max(maxInput, visit(ik, [...stack, r]))
        if (cycle) {
          color.set(r, 'black')
          levels[r] = lvl
          return lvl
        }
      }
      lvl = Math.max(lvl, 1 + maxInput)
    }
    color.set(r, 'black')
    levels[r] = lvl
    return lvl
  }

  for (const r of RESOURCE_KINDS) {
    if (cycle) break
    visit(r, [])
  }

  // 未訪問 (cycle break 等) の resource は 0 で埋める。
  const full: Record<ResourceKind, number> = {} as Record<ResourceKind, number>
  for (const r of RESOURCE_KINDS) {
    full[r] = levels[r] ?? 0
  }
  return { levels: full, cycle }
}

// 静的 config から導出した resource level (定義時 1 回計算)。
const RESOURCE_LEVEL_RESULT = computeResourceLevels(PRODUCTION_RECIPE_DEFINITIONS)
export const RESOURCE_LEVELS: Record<ResourceKind, number> = RESOURCE_LEVEL_RESULT.levels

// recipe 依存グラフに循環があれば cycle 経路、無ければ null (§12.2 IntegrityCheck 用)。
export const RESOURCE_DEPENDENCY_CYCLE: ResourceKind[] | null = RESOURCE_LEVEL_RESULT.cycle

// 昇順 unique level 列 (清算の topological 反復順)。
export const RESOURCE_LEVELS_SORTED: readonly number[] = Array.from(
  new Set(RESOURCE_KINDS.map((r) => RESOURCE_LEVELS[r])),
).sort((a, b) => a - b)
