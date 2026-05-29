import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId } from '../types/ids'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopOccupation } from '../types/popGroup'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
import { clamp } from '../utils/math'

export function getHoldingDevelopment(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string]
  if (!improvementIds || improvementIds.length === 0) return 0

  let development = 0
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (!imp) continue
    const score = config.holdingImprovementDevelopmentScorePerLevel[imp.kind]
    if (score !== undefined) {
      development += imp.level * score
    }
  }
  return development
}

export function getHoldingDevelopmentModifier(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  const development = getHoldingDevelopment(state, config, holdingId)
  return clamp(1.0 + development / 150, 0.75, 1.75)
}

export function getHoldingImprovementLevel(
  state: WorldState,
  holdingId: HoldingId,
  kind: HoldingImprovementKind,
): number {
  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string]
  if (!improvementIds) return 0
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (imp && imp.kind === kind) return imp.level
  }
  return 0
}

// v0.33 §10.5: state 非依存の純粋 capacity helper。selector / worldgen seeding 双方から呼ぶ。
// capacity(holding, occupation) = (base + improvementDerivedCapacity) * weight * landQuality
// capacity 側では developmentModifier を使わない（§6.3 二重計上回避）。
export function computeHoldingOccupationCapacity(
  holdingKind: HoldingKind,
  weight: number,
  landQuality: number,
  terrain: ProvinceTerrain,
  features: readonly ProvinceFeature[],
  improvements: ReadonlyArray<{ kind: HoldingImprovementKind; level: number }>,
  config: SimulationConfig,
  occupation: PopOccupation,
): number {
  if (occupation === 'none') return 0
  const base = config.occupationCapacityBaseByHoldingKind[holdingKind][occupation]

  let derived = 0
  for (const imp of improvements) {
    // capacityPerLevel[kind][occupation] 未定義 → その occupation の寄与は 0
    const perLevel = config.holdingImprovementOccupationCapacityPerLevel[imp.kind][occupation]
    if (perLevel === undefined) continue
    // terrainMultiplier 未定義 → 1.0（clamp なし）
    const terrainMult = config.holdingImprovementTerrainCapacityMultiplier[imp.kind][terrain] ?? 1.0
    // featureMultiplier = clamp(Π(該当 feature の積), 0.75, 1.50)。feature 無→空積 1.0
    let featureProduct = 1.0
    for (const f of features) {
      featureProduct *= config.holdingImprovementFeatureCapacityMultiplier[imp.kind][f] ?? 1.0
    }
    const featureMult = clamp(featureProduct, 0.75, 1.5)
    derived += imp.level * perLevel * terrainMult * featureMult
  }

  return (base + derived) * weight * landQuality
}

// v0.33 §9.1: state 非依存の建設可否判定。worldgen 初期生成からも呼ぶ。
export function canBuildHoldingImprovementPure(
  holdingKind: HoldingKind,
  terrain: ProvinceTerrain,
  features: readonly ProvinceFeature[],
  currentLevel: number,
  kind: HoldingImprovementKind,
  config: SimulationConfig,
): boolean {
  const def = IMPROVEMENT_DEFINITIONS[kind]
  // 2. holdingKind が allowedHoldingKinds に含まれる
  if (!def.allowedHoldingKinds.includes(holdingKind)) return false
  // 3. terrain が allowedTerrains に含まれる（未指定なら全 terrain 許可）
  if (def.allowedTerrains && !def.allowedTerrains.includes(terrain)) return false
  // 4. requiredAnyFeatures があれば、features のいずれかが一致する
  if (def.requiredAnyFeatures && def.requiredAnyFeatures.length > 0) {
    if (!def.requiredAnyFeatures.some((f) => features.includes(f))) return false
  }
  // 5. maxLevel > 0 かつ currentLevel < maxLevel（未定義/0 = 建設不可）
  const maxLevel = config.holdingImprovementMaxLevelByKind[kind][holdingKind] ?? 0
  if (maxLevel <= 0) return false
  if (currentLevel >= maxLevel) return false
  return true
}

// state を取る薄いラッパ。currentLevel は既存 improvement から導出。
export function canBuildHoldingImprovement(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  kind: HoldingImprovementKind,
): boolean {
  const holding = state.holdings[holdingId]
  if (!holding) return false
  const province = state.provinces[holding.provinceId]
  if (!province) return false
  const currentLevel = getHoldingImprovementLevel(state, holdingId, kind)
  return canBuildHoldingImprovementPure(
    holding.kind,
    province.terrain,
    province.features,
    currentLevel,
    kind,
    config,
  )
}
