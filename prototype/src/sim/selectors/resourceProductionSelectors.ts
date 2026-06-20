import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PopClass } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import { REAL_ESTATE_DEFINITIONS } from '../config/realEstateDefinitions'
import {
  computeInfrastructureModifier,
  computeSlotOveruseModifier,
} from './holdingImprovementSelectors'
import { getHoldingEmployedPopSize, getHoldingClassCapacity } from './popSelectors'
import { clamp } from '../utils/math'

// v0.54 §9 規模の経済: 同 asset 内で同 recipe を多く採用するほど slot あたり生産性が上がる。
export function getRecipeScaleMultiplier(
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
export function computePolityControlModifier(
  polityControl: number,
  config: SimulationConfig,
): number {
  const min = config.resourceEconomyControlModifierMin
  return clamp(min + (polityControl / 100) * (1 - min), min, 1.0)
}

// v0.54 §12.2 assetLevelModifier。
export function computeAssetLevelModifier(level: number, config: SimulationConfig): number {
  const bonus = config.realEstateLevelOutputBonus
  if (bonus === undefined) return level
  return 1 + (level - 1) * bonus
}

// v0.54 §11.4 staffingFulfillment: 施設を運用する人員の充足率 proxy。
//   degeneration-avoidance pass では holding-level の class 別 employed/capacity を proxy とする (§11.4 簡易案)。
export function computeStaffingFulfillment(used: number, capacity: number): number {
  if (capacity <= 0) return 1.0
  return clamp(used / capacity, 0, 1)
}

// v0.54 §10.2 / §23 Step 2: per-asset の class capacity 寄与。
//   既存 computeHoldingClassCapacity の asset_term を単一 asset について計算したもの
//   (holding 共通の overuseMod / landQuality / weight も掛けて faithful な capacity 値にする)。
//   labor 按分の weight に使う (holding 共通項は比率で相殺するため weight としては asset 固有項だけでも足りる)。
export function getRealEstateAssetClassCapacityContribution(
  state: WorldState,
  asset: RealEstateAsset,
  popClass: PopClass,
  config: SimulationConfig,
): number {
  const holding = state.holdings[asset.holdingId]
  if (!holding) return 0
  const province = state.provinces[holding.provinceId]
  if (!province) return 0

  const def = REAL_ESTATE_DEFINITIONS[asset.realEstateKind]
  let assetTerm = 0
  for (const slot of def.employmentSlots) {
    if (slot.popClass !== popClass) continue
    const terrainMult =
      config.realEstateTerrainCapacityMultiplier[asset.realEstateKind][province.terrain] ?? 1.0
    let featureProduct = 1.0
    for (const f of province.features) {
      featureProduct *= config.realEstateFeatureCapacityMultiplier[asset.realEstateKind][f] ?? 1.0
    }
    const featureMult = clamp(featureProduct, 0.75, 1.5)

    const improvements: { kind: HoldingImprovementKind; level: number; condition: number }[] = []
    const improvementIds = state.holdingImprovementIndex.byHolding[asset.holdingId as string] ?? []
    for (const impId of improvementIds) {
      const imp = state.holdingImprovements[impId]
      if (imp) improvements.push({ kind: imp.kind, level: imp.level, condition: imp.condition })
    }
    const infraMod = computeInfrastructureModifier(asset.realEstateKind, improvements, config)
    assetTerm += slot.capacityPerLevel * asset.level * terrainMult * featureMult * infraMod
  }

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
export function computeProductionFacilityModifier(
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
