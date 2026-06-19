import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingId } from '../types/ids'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { HoldingKind } from '../types/landContract'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { PopClass } from '../types/popGroup'
import type { RealEstateKind } from '../types/realEstateAsset'
import { IMPROVEMENT_DEFINITIONS } from '../config/improvementDefinitions'
import { REAL_ESTATE_DEFINITIONS } from '../config/realEstateDefinitions'
import { clamp } from '../utils/math'

// v0.48.1 §3: condition による生産 effectiveness。閾値以上は full (1.0)、未満は線形低下 (下限 minFloor)。
// bimodal: 健全はフラット稼働 / 機能不全 (閾値割れ) で初めて出力が崖状に落ちる。
export function conditionEffectiveness(
  condition: number,
  threshold: number,
  minFloor: number,
): number {
  if (condition >= threshold) return 1
  if (threshold <= 0) return 1
  return Math.max(minFloor, condition / threshold)
}

export function getHoldingDevelopment(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): number {
  let development = 0

  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string]
  if (improvementIds) {
    for (const impId of improvementIds) {
      const imp = state.holdingImprovements[impId]
      if (!imp) continue
      const score = config.holdingImprovementDevelopmentScorePerLevel[imp.kind]
      if (score !== undefined) {
        const eff = conditionEffectiveness(
          imp.condition,
          config.facilityDisrepairThreshold,
          config.facilityDisrepairMinEffectiveness,
        )
        development += imp.level * score * eff
      }
    }
  }

  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string]
  if (assetIds) {
    for (const aId of assetIds) {
      const asset = state.realEstateAssets[aId]
      if (!asset) continue
      const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
      development += asset.level * def.developmentScorePerLevel
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

// v0.48.1: condition を加味した実効レベル = level × conditionEffectiveness(condition)。
//   機能不全 (condition < 閾値) の設備は効果が下がり、condition 0 で実効 0 (= 効果消失)。
//   設備効果が「健全であってこそ発揮される」べき箇所 (Crisis 被害軽減など) で使う。
//   1 holding 1 kind は単一 improvement 想定 (integrity の重複検査) なので最初の一致を返す。
export function getHoldingImprovementEffectiveLevel(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  kind: HoldingImprovementKind,
): number {
  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string]
  if (!improvementIds) return 0
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (imp && imp.kind === kind) {
      return (
        imp.level *
        conditionEffectiveness(
          imp.condition,
          config.facilityDisrepairThreshold,
          config.facilityDisrepairMinEffectiveness,
        )
      )
    }
  }
  return 0
}

export function computeInfrastructureModifier(
  realEstateKind: RealEstateKind,
  improvements: ReadonlyArray<{ kind: HoldingImprovementKind; level: number; condition: number }>,
  config: SimulationConfig,
): number {
  const modDefs = config.realEstateInfrastructureModifiers[realEstateKind]
  let product = 1.0
  for (const modDef of modDefs) {
    for (const imp of improvements) {
      if (imp.kind !== modDef.infraKind) continue
      const eff = conditionEffectiveness(
        imp.condition,
        config.facilityDisrepairThreshold,
        config.facilityDisrepairMinEffectiveness,
      )
      product *= 1 + imp.level * modDef.modifierPerLevel * eff
    }
  }
  return product
}

export function computeSlotOveruseModifier(
  usedSlots: number,
  currentSlotCapacity: number,
  config: SimulationConfig,
): number {
  if (currentSlotCapacity <= 0) return config.minSlotOveruseModifier
  if (usedSlots <= currentSlotCapacity) return 1.0
  return clamp(currentSlotCapacity / usedSlots, config.minSlotOveruseModifier, 1.0)
}

// v0.52: capacity = (asset_term + infra_term) × weight
// asset_term = Σ(slot.capacityPerLevel × level × terrainMult × featureMult × infraMod) × slotOveruseMod × landQuality
// infra_term = Σ(slot.capacityPerLevel × imp.level × conditionEffectiveness)
export function computeHoldingClassCapacity(
  _holdingKind: HoldingKind,
  weight: number,
  landQuality: number,
  terrain: ProvinceTerrain,
  features: readonly ProvinceFeature[],
  improvements: ReadonlyArray<{ kind: HoldingImprovementKind; level: number; condition: number }>,
  config: SimulationConfig,
  popClass: PopClass,
  assets?: ReadonlyArray<{ realEstateKind: RealEstateKind; level: number }>,
  slotOveruseModifier?: number,
): number {
  let assetTerm = 0
  if (assets && assets.length > 0) {
    for (const asset of assets) {
      const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
      for (const slot of def.employmentSlots) {
        if (slot.popClass !== popClass) continue

        const terrainMult =
          config.realEstateTerrainCapacityMultiplier[asset.realEstateKind][terrain] ?? 1.0
        let featureProduct = 1.0
        for (const f of features) {
          featureProduct *=
            config.realEstateFeatureCapacityMultiplier[asset.realEstateKind][f] ?? 1.0
        }
        const featureMult = clamp(featureProduct, 0.75, 1.5)
        const infraMod = computeInfrastructureModifier(asset.realEstateKind, improvements, config)
        assetTerm += slot.capacityPerLevel * asset.level * terrainMult * featureMult * infraMod
      }
    }
  }
  const overuseMod = slotOveruseModifier ?? 1.0
  assetTerm = assetTerm * overuseMod * landQuality

  let infraTerm = 0
  for (const imp of improvements) {
    const impDef = IMPROVEMENT_DEFINITIONS[imp.kind]
    if (!impDef.employmentSlots) continue
    for (const slot of impDef.employmentSlots) {
      if (slot.popClass !== popClass) continue
      let eff = conditionEffectiveness(
        imp.condition,
        config.facilityDisrepairThreshold,
        config.facilityDisrepairMinEffectiveness,
      )
      if (impDef.critical) eff = Math.max(eff, config.criticalInfraMinEffectiveness)
      infraTerm += slot.capacityPerLevel * imp.level * eff
    }
  }

  return (assetTerm + infraTerm) * weight
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

export function canBuildRealEstateAssetPure(
  holdingKind: HoldingKind,
  terrain: ProvinceTerrain,
  features: readonly ProvinceFeature[],
  kind: RealEstateKind,
): boolean {
  const def = REAL_ESTATE_DEFINITIONS[kind]
  if (!def.allowedHoldingKinds.includes(holdingKind)) return false
  if (def.allowedTerrains && !def.allowedTerrains.includes(terrain)) return false
  if (def.requiredAnyFeatures && def.requiredAnyFeatures.length > 0) {
    if (!def.requiredAnyFeatures.some((f) => features.includes(f))) return false
  }
  const maxLevel = def.maxLevelByHoldingKind[holdingKind] ?? 0
  if (maxLevel <= 0) return false
  return true
}

export function canBuildRealEstateAsset(
  state: WorldState,
  holdingId: HoldingId,
  kind: RealEstateKind,
): boolean {
  const holding = state.holdings[holdingId]
  if (!holding) return false
  const province = state.provinces[holding.provinceId]
  if (!province) return false
  return canBuildRealEstateAssetPure(holding.kind, province.terrain, province.features, kind)
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
