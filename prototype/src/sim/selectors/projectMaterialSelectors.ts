import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { Project } from '../types/project'
import type { ResourceKind } from '../types/resource'
import { INPUT_CATEGORY_CONTRIBUTIONS } from '../types/inputCategory'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import {
  REAL_ESTATE_MATERIAL_PROFILE,
  IMPROVEMENT_MATERIAL_PROFILE,
  CRISIS_REPAIR_MATERIAL_PROFILE,
  type ProjectMaterialRequirement,
} from '../config/projectMaterialDefinitions'

// v0.55 §18: Project の建築資材需要 profile を target から引く (B4 2 段キー)。
//   対象外 Project (建設・修繕でない) は null。
export function getProjectMaterialRequirements(
  state: WorldState,
  project: Project,
): ProjectMaterialRequirement[] | null {
  if (project.kind === 'develop_real_estate' || project.kind === 'upgrade_owned_real_estate') {
    return REAL_ESTATE_MATERIAL_PROFILE[project.realEstateKind]
  }
  if (project.kind === 'develop_holding') {
    return IMPROVEMENT_MATERIAL_PROFILE[project.improvementKind]
  }
  if (project.kind === 'handle_crisis') {
    const crisis = state.crises[project.crisisId]
    if (!crisis) return null
    return CRISIS_REPAIR_MATERIAL_PROFILE[crisis.kind] ?? null
  }
  return null
}

// category を満たす単一 ResourceKind (construction_* は単一資源)。複数の場合は contribution 最大を採る。
function soleResourceForCategory(req: ProjectMaterialRequirement): {
  resource: ResourceKind
  contributionValue: number
} | null {
  const contributions = INPUT_CATEGORY_CONTRIBUTIONS[req.category]
  let best: { resource: ResourceKind; contributionValue: number } | null = null
  for (const r of Object.keys(contributions) as ResourceKind[]) {
    const v = contributions[r]
    if (v === undefined) continue
    if (!best || v > best.contributionValue) best = { resource: r, contributionValue: v }
  }
  return best
}

export type ProjectMaterialBaseUnit = { resource: ResourceKind; baseUnits: number }

// §18.3 / §19: 1 advance task あたりの基準材料数量 (basePrice 換算で budget の per-advance share を
//   weight 配分し、各 category の単一資源の数量へ変換)。smoothedPrice で評価し直して実コストを得る。
export function computeProjectMaterialBaseUnits(
  state: WorldState,
  config: SimulationConfig,
  project: Project,
): ProjectMaterialBaseUnit[] {
  const reqs = getProjectMaterialRequirements(state, project)
  if (!reqs || reqs.length === 0) return []
  const budget = 'budget' in project ? project.budget : undefined
  if (!budget || typeof budget !== 'object') return []
  const required = budget.required
  if (!(required > 0)) return []
  const expectedTasks = Math.max(
    1,
    Math.ceil(project.targetProgress / config.projectAdvanceProgressSuccess),
  )
  const perAdvanceCost = required / expectedTasks
  const totalWeight = reqs.reduce((a, r) => a + r.weight, 0)
  if (totalWeight <= 0) return []

  const byResource = new Map<ResourceKind, number>()
  for (const req of reqs) {
    const sole = soleResourceForCategory(req)
    if (!sole) continue
    const costShare = perAdvanceCost * (req.weight / totalWeight)
    // baseUnits = costShare / (basePrice × contributionValue)。
    const basePrice = RESOURCE_PRICE_DEFINITIONS[sole.resource].basePrice
    if (basePrice <= 0) continue
    const units = costShare / (basePrice * sole.contributionValue)
    byResource.set(sole.resource, (byResource.get(sole.resource) ?? 0) + units)
  }
  return [...byResource.entries()].map(([resource, baseUnits]) => ({ resource, baseUnits }))
}

// §19.3: Project 対象 holding の StateRegion 市場 key。
export function getProjectMarketKey(state: WorldState, project: Project): string | null {
  if (!('holdingId' in project) || project.holdingId === undefined) return null
  const holding = state.holdings[project.holdingId]
  if (!holding) return null
  const province = state.provinces[holding.provinceId]
  if (!province) return null
  return province.stateId
}
