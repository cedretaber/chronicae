import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, HoldingId, StateRegionId } from '../types/ids'
import type { PopGroup, PopClass, PopType } from '../types/popGroup'
import type { HoldingImprovementKind } from '../types/holdingImprovement'
import type { RealEstateKind } from '../types/realEstateAsset'
import type { ResourceKind } from '../types/resource'
import { clamp } from '../utils/math'
import { FOOD_RESOURCE_VALUE, FOOD_NEED_CATEGORIES } from '../config/popFoodDefinitions'
import { POP_NEED_PROFILES } from '../config/popNeedDefinitions'
import { NEED_CATEGORY_TIER } from '../types/needCategory'
import { marketResourcePriceKey } from '../types/resourceEconomy'
import {
  computeHoldingClassCapacity,
  computeHoldingPopTypeCapacity,
  computeHoldingAllPopTypeCapacities,
  computeSlotOveruseModifier,
} from './holdingImprovementSelectors'
import { computeSlotCapacity } from './terrainTraitSelectors'
import { popGroupChangeKey } from '../types/popChange'
import { POP_TYPE_MAX_RATIO } from '../config/realEstateDefinitions'

// Returns all PopGroups for a province (empty array if none)
export function getProvincePops(state: WorldState, provinceId: ProvinceId): PopGroup[] {
  const province = state.provinces[provinceId]
  if (!province) return []

  const result: PopGroup[] = []
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      result.push(pop)
    }
  }
  return result
}

// Returns total population size for a province
export function getProvincePopulation(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let total = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      total += pop.size
    }
  }
  return total
}

// Returns the weighted average wealth of all POPs in a province (0 if no pops)
// v0.58: POP の welfare 指標は wealth(退役) から needSatisfaction(0..100) へ移行。
export function getProvinceAveragePopNeedSatisfaction(
  state: WorldState,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let weightedSum = 0
  let totalPopulation = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      weightedSum += pop.needSatisfaction * pop.size
      totalPopulation += pop.size
    }
  }
  if (totalPopulation === 0) return 0
  return weightedSum / totalPopulation
}

const POP_CLASSES: PopClass[] = ['lower', 'middle', 'upper']

// v0.55 POP 再設計: state (= 食料市場) の食料供給。直近 clearing の food 資源 sellOrders × food value 合計。
export function getStateFoodSupply(state: WorldState, stateId: StateRegionId): number {
  let total = 0
  for (const [resource, value] of Object.entries(FOOD_RESOURCE_VALUE) as [ResourceKind, number][]) {
    const ps = state.marketResourcePrices[marketResourcePriceKey(stateId, resource)]
    if (!ps) continue
    const last = ps.history[ps.history.length - 1]
    if (!last) continue
    total += last.sellOrders * value
  }
  return total
}

// v0.60.3: POP 1 人あたりの月次「食料需要」(value 単位)。供給側 getStateFoodSupply と同じ
//   FOOD_NEED_CATEGORIES (staple_food/protein/fine_food) を、需要側 computePopNeedDemand と同じ
//   tierScale (essential は popEssentialNeedScale) で合算する。食料カテゴリ内では
//   FOOD_RESOURCE_VALUE[r] == contributionValue_r のため price 依存の資源選択 share が相殺し、
//   per-capita 需要は profile×tierScale の純和になる (= 実消費量)。これにより carrying capacity の
//   生存閾値が needSatisfaction の実需要と構造的に同一の物差しになり、config を触っても drift しない。
export function getPerCapitaFoodNeed(config: SimulationConfig, popType: PopType): number {
  const profile = POP_NEED_PROFILES[popType]
  let need = 0
  for (const cat of FOOD_NEED_CATEGORIES) {
    const tierScale = NEED_CATEGORY_TIER[cat] === 'essential' ? config.popEssentialNeedScale : 1
    need += profile[cat] * tierScale
  }
  return need
}

// v0.60.3: state 全 POP の月次食料需要総量 (= Σ size × getPerCapitaFoodNeed(popType))。
//   getStatePopulation と同一の反復順 (provinceIds → holdingIds → byHolding) で決定的に合算する。
export function getStateFoodRequirement(
  state: WorldState,
  config: SimulationConfig,
  stateId: StateRegionId,
): number {
  const region = state.states[stateId]
  if (!region) return 0
  let total = 0
  for (const provinceId of region.provinceIds) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const holdingId of province.holdingIds) {
      const popIds = state.popIndex.byHolding[holdingId]
      if (!popIds) continue
      for (const popId of popIds) {
        const pop = state.popGroups[popId]
        if (!pop) continue
        total += pop.size * getPerCapitaFoodNeed(config, pop.popType)
      }
    }
  }
  return total
}

// v0.60.3: state の「養える人口」= max(floor, foodSupply / 人口加重 per-capita 食料需要)。
//   v0.55 の固定 perCapitaFoodNeed(=1.0) を、需要側と同じ導出値の人口加重平均へ置換し、
//   「満腹なのに自然減」を生んでいた生存閾値(1.0)と実需要(~0.6)の校正ずれを解消する。
export function getStateCarryingCapacity(
  state: WorldState,
  config: SimulationConfig,
  stateId: StateRegionId,
): number {
  const supply = getStateFoodSupply(state, stateId)
  const population = getStatePopulation(state, stateId)
  const requirement = getStateFoodRequirement(state, config, stateId)
  // 人口加重 per-capita 需要。人口ゼロ時は base profile (peasants) で代替 (pressure は 0 になるため無影響)。
  const perCapita =
    population > 0 ? requirement / population : getPerCapitaFoodNeed(config, 'peasants')
  const cc = supply / Math.max(perCapita, 0.0001)
  return Math.max(config.minProvinceCarryingCapacity, cc)
}

export function getStatePopulation(state: WorldState, stateId: StateRegionId): number {
  const region = state.states[stateId]
  if (!region) return 0
  let total = 0
  for (const provinceId of region.provinceIds) {
    total += getProvincePopulation(state, provinceId)
  }
  return total
}

// v0.55 POP 再設計: carrying capacity は食料市場 (state 単位) ベース。同一 state の全 province が共有する。
export function getProvinceCarryingCapacity(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return config.minProvinceCarryingCapacity
  return getStateCarryingCapacity(state, config, province.stateId)
}

// Returns population pressure: state 人口 / state 食料 carrying capacity (clamped 0..2)。
//   食料市場は state 単位のため、同一 state の全 province は同じ食料 pressure を共有する。
export function getProvincePopulationPressure(
  state: WorldState,
  config: SimulationConfig,
  provinceId: ProvinceId,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  const capacity = getStateCarryingCapacity(state, config, province.stateId)
  if (capacity === 0) return 0
  return clamp(getStatePopulation(state, province.stateId) / capacity, 0, 2)
}

// Returns weighted average unrest across all POPs in a province (0 if no pops)
export function getProvinceUnrest(state: WorldState, provinceId: ProvinceId): number {
  const province = state.provinces[provinceId]
  if (!province) return 0

  let weightedSum = 0
  let totalPopulation = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop) continue
      weightedSum += pop.unrest * pop.size
      totalPopulation += pop.size
    }
  }
  if (totalPopulation === 0) return 0
  return weightedSum / totalPopulation
}

// Returns the weighted average unrest of all POPs with the given class in the province
export function getPopUnrestByClass(
  state: WorldState,
  provinceId: ProvinceId,
  popClass: PopClass,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let weightedSum = 0
  let totalSize = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop || pop.class !== popClass) continue
      weightedSum += pop.unrest * pop.size
      totalSize += pop.size
    }
  }
  return totalSize > 0 ? weightedSum / totalSize : 0
}

// Returns the weighted average wealth of all POPs with the given class in the province
// v0.58: class 別の welfare 平均 (needSatisfaction・size 加重)。wealth から移行。
export function getPopNeedSatisfactionByClass(
  state: WorldState,
  provinceId: ProvinceId,
  popClass: PopClass,
): number {
  const province = state.provinces[provinceId]
  if (!province) return 0
  let weightedSum = 0
  let totalSize = 0
  for (const holdingId of province.holdingIds) {
    const popIds = state.popIndex.byHolding[holdingId]
    if (!popIds) continue
    for (const popId of popIds) {
      const pop = state.popGroups[popId]
      if (!pop || pop.class !== popClass) continue
      weightedSum += pop.needSatisfaction * pop.size
      totalSize += pop.size
    }
  }
  return totalSize > 0 ? weightedSum / totalSize : 0
}

// --- Holding POP selectors ---

export function getHoldingPops(state: WorldState, holdingId: HoldingId): PopGroup[] {
  const popIds = state.popIndex.byHolding[holdingId]
  if (!popIds) return []
  const result: PopGroup[] = []
  for (const popId of popIds) {
    const pop = state.popGroups[popId]
    if (pop) result.push(pop)
  }
  return result
}

function getHoldingPopsByClass(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): PopGroup[] {
  return getHoldingPops(state, holdingId).filter((p) => p.class === popClass)
}

export function getHoldingPopSizeByClass(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  return getHoldingPopsByClass(state, holdingId, popClass).reduce((sum, p) => sum + p.size, 0)
}

// v0.56: holding 内の全 PopGroup の size 合計 (転職・移住の人口比 cap / 混雑度に使用)。
export function getHoldingTotalPopSize(state: WorldState, holdingId: HoldingId): number {
  let total = 0
  for (const pid of state.popIndex.byHolding[holdingId] ?? []) {
    const p = state.popGroups[pid]
    if (p) total += p.size
  }
  return total
}

export function getHoldingPopsByClassAndEmployment(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  employed: boolean,
): PopGroup[] {
  return getHoldingPops(state, holdingId).filter(
    (p) => p.class === popClass && p.employed === employed,
  )
}

export function getHoldingEmployedPopSize(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  return getHoldingPopsByClassAndEmployment(state, holdingId, popClass, true).reduce(
    (sum, p) => sum + p.size,
    0,
  )
}

export function getHoldingUnemployedPopSize(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  return getHoldingPopsByClassAndEmployment(state, holdingId, popClass, false).reduce(
    (sum, p) => sum + p.size,
    0,
  )
}

// holding の容量計算に必要な入力 (holding/province 属性・improvements・assets・overuseMod) を 1 度だけ収集する。
//   getHoldingClassCapacity / getHoldingPopTypeCapacity / getHoldingAllPopTypeCapacities が共有する。
function collectHoldingCapacityInputs(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
) {
  const holding = state.holdings[holdingId]
  if (!holding) return null
  const province = state.provinces[holding.provinceId]
  if (!province) return null

  const improvementIds = state.holdingImprovementIndex.byHolding[holdingId as string] ?? []
  const improvements: { kind: HoldingImprovementKind; level: number; condition: number }[] = []
  for (const impId of improvementIds) {
    const imp = state.holdingImprovements[impId]
    if (imp) improvements.push({ kind: imp.kind, level: imp.level, condition: imp.condition })
  }

  const assetIds = state.realEstateAssetIndex.byHolding[holdingId as string] ?? []
  const assets: { realEstateKind: RealEstateKind; level: number }[] = []
  for (const aId of assetIds) {
    const asset = state.realEstateAssets[aId]
    if (asset) assets.push({ realEstateKind: asset.realEstateKind, level: asset.level })
  }

  const slotCap = computeSlotCapacity(config, holding.kind, province.traits)
  const overuseMod = computeSlotOveruseModifier(assets.length, slotCap, config)

  return { holding, province, improvements, assets, overuseMod }
}

export function getHoldingClassCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  const inputs = collectHoldingCapacityInputs(state, config, holdingId)
  if (!inputs) return 0
  const { holding, province, improvements, assets, overuseMod } = inputs
  return computeHoldingClassCapacity(
    holding.kind,
    holding.weight,
    province.terrain,
    province.features,
    improvements,
    config,
    popClass,
    assets,
    overuseMod,
  )
}

export function getHoldingClassRemainingCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popClass: PopClass,
): number {
  const capacity = getHoldingClassCapacity(state, config, holdingId, popClass)
  const used = getHoldingEmployedPopSize(state, holdingId, popClass)
  return Math.max(0, capacity - used)
}

// v0.57 §雇用細分化: holding × PopType の雇用 helper 群。
//   class 版 (getHoldingClassCapacity 等) の PopType 粒度版。施設駆動のハード枠を表現する。
export function getHoldingPopsByTypeAndEmployment(
  state: WorldState,
  holdingId: HoldingId,
  popType: PopType,
  employed: boolean,
): PopGroup[] {
  return getHoldingPops(state, holdingId).filter(
    (p) => p.popType === popType && p.employed === employed,
  )
}

export function getHoldingEmployedPopSizeByType(
  state: WorldState,
  holdingId: HoldingId,
  popType: PopType,
): number {
  return getHoldingPopsByTypeAndEmployment(state, holdingId, popType, true).reduce(
    (sum, p) => sum + p.size,
    0,
  )
}

export function getHoldingPopTypeCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popType: PopType,
): number {
  const inputs = collectHoldingCapacityInputs(state, config, holdingId)
  if (!inputs) return 0
  const { holding, province, improvements, assets, overuseMod } = inputs
  return computeHoldingPopTypeCapacity(
    holding.kind,
    holding.weight,
    province.terrain,
    province.features,
    improvements,
    config,
    popType,
    assets,
    overuseMod,
  )
}

// v0.59 追補: 生容量を maxRatio (熟練職の同数上限) で絞る共有 helper。
//   熟練職 (親方/自作農) は POP_TYPE_MAX_RATIO により下層同種職の実雇用数 × ratio で雇用上限が縛られる。
//   判断系 (転職/移住/昇格 gate・shortage) と employmentRebalanceSystem の両方がこの 1 箇所を共有し、
//   絞り込み式の重複を排除する。refEmployed は呼び出し時点の live employed を読むため、rebalance の
//   ように loop 内で参照先の雇用が変わる文脈でもそのまま使える。
export function clampCapacityByMaxRatio(
  state: WorldState,
  holdingId: HoldingId,
  popType: PopType,
  rawCapacity: number,
): number {
  const maxRatio = POP_TYPE_MAX_RATIO[popType]
  if (!maxRatio) return rawCapacity
  const refEmployed = getHoldingEmployedPopSizeByType(state, holdingId, maxRatio.popType)
  return Math.min(rawCapacity, refEmployed * maxRatio.ratio)
}

// v0.59 追補: 判断系専用の「実効容量」(生容量を maxRatio で絞った値)。「絶対に埋まらない幻の枠」を
//   shortage/空き枠として誤計上しないために使う。
export function getHoldingPopTypeEffectiveCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popType: PopType,
): number {
  return clampCapacityByMaxRatio(
    state,
    holdingId,
    popType,
    getHoldingPopTypeCapacity(state, config, holdingId, popType),
  )
}

export function getHoldingPopTypeRemainingCapacity(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  popType: PopType,
): number {
  // v0.59 追補: 昇格 gate・lateral capacity gate で「埋まらない幻の枠」を弾くため実効容量を使う。
  const capacity = getHoldingPopTypeEffectiveCapacity(state, config, holdingId, popType)
  const used = getHoldingEmployedPopSizeByType(state, holdingId, popType)
  return Math.max(0, capacity - used)
}

// v0.57: holding の全 PopType 容量を 1 パスで取得 (demand/rebalance の per-PopType ループ用)。
export function getHoldingAllPopTypeCapacities(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): Partial<Record<PopType, number>> {
  const inputs = collectHoldingCapacityInputs(state, config, holdingId)
  if (!inputs) return {}
  const { holding, province, improvements, assets, overuseMod } = inputs
  return computeHoldingAllPopTypeCapacities(
    holding.weight,
    province.terrain,
    province.features,
    improvements,
    config,
    assets,
    overuseMod,
  )
}

export function hasCapacityPressure(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): boolean {
  for (const pc of POP_CLASSES) {
    const cap = getHoldingClassCapacity(state, config, holdingId, pc)
    if (cap <= 0) continue
    const employed = getHoldingEmployedPopSize(state, holdingId, pc)
    if (employed / cap >= config.developRealEstateCapacityPressureThreshold) return true
  }
  return false
}

// v0.55 §B: holding 内のいずれかのクラスで失業 POP が閾値以上いるか。
//   capacity pressure (既存施設の満員度) と独立した拡張トリガで、idle labor を新規開発/レベルアップで
//   雇用に変えられる状況を捉える。失業者がいると employed/cap はむしろ低く、capacity pressure では
//   検出できない (意図と逆) ためのシグナル。pure read・RNG 不使用。
export function hasEmploymentSlack(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): boolean {
  for (const pc of POP_CLASSES) {
    if (
      getHoldingUnemployedPopSize(state, holdingId, pc) >=
      config.developRealEstateEmploymentSlackThreshold
    )
      return true
  }
  return false
}

// v0.59: 先月 (直近 4 週) の人口変動 read-model を holding 単位で取得 (pure read)。
//   net = natural + migrationIn − migrationOut。read-model 未生成 (最初の月初前) は undefined。
export function getHoldingMonthlyPopChange(
  state: WorldState,
  holdingId: HoldingId,
): { natural: number; migrationIn: number; migrationOut: number; net: number } | undefined {
  const snapshot = state.monthlyPopChange
  if (!snapshot) return undefined
  const e = snapshot.byHolding[holdingId] ?? { natural: 0, migrationIn: 0, migrationOut: 0 }
  return {
    natural: e.natural,
    migrationIn: e.migrationIn,
    migrationOut: e.migrationOut,
    net: e.natural + e.migrationIn - e.migrationOut,
  }
}

// v0.59: 先月の人口変動を POP グループ単位で取得。net は自然増減 + 移住の小計
//   (転職・雇用変動は含まない → POP グループの素の size 差分とは一致しない。それらは
//   monthlyPopMobility の階層移動セクションに集約)。read-model 未生成は undefined。
export function getPopGroupMonthlyPopChange(
  state: WorldState,
  pop: PopGroup,
): { natural: number; migrationIn: number; migrationOut: number; net: number } | undefined {
  const snapshot = state.monthlyPopChange
  if (!snapshot) return undefined
  const key = popGroupChangeKey(pop.holdingId, pop.class, pop.popType, pop.employed)
  const e = snapshot.byPopGroupKey[key] ?? { natural: 0, migrationIn: 0, migrationOut: 0 }
  return {
    natural: e.natural,
    migrationIn: e.migrationIn,
    migrationOut: e.migrationOut,
    net: e.natural + e.migrationIn - e.migrationOut,
  }
}
