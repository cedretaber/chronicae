import type { Province, TerrainTraitKind } from '../types/province'
import type { HoldingKind } from '../types/landContract'
import type { SimulationConfig } from '../config/defaultConfig'
import type { WorldState } from '../types/world'
import type { HoldingId } from '../types/ids'
import type { ResourceKind } from '../types/resource'
import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'

/**
 * v0.59: Province 群に地形特性を決定的に付与する。Province は入力順・trait は定義順に走査し、
 * 適合（terrain/feature 一致）すれば `probability × terrainTraitDensityMultiplier`（0..1 clamp）
 * で抽選する。RNG は適合判定が成立した trait についてのみ 1 回消費する（density 0 でも判定は
 * 行うが付与されない＝RNG 消費順は density に依らず一定）。
 */
export function assignTerrainTraits(
  provinces: Province[],
  config: SimulationConfig,
  rng: RngState,
): { provinces: Province[]; rng: RngState } {
  const density = config.terrainTraitDensityMultiplier
  const out: Province[] = []
  let cur = rng
  for (const province of provinces) {
    const traits: TerrainTraitKind[] = []
    for (const def of config.terrainTraitDefinitions) {
      const terrainOk = !def.eligibleTerrains || def.eligibleTerrains.includes(province.terrain)
      const featureOk =
        !def.eligibleFeatures || def.eligibleFeatures.some((f) => province.features.includes(f))
      if (!terrainOk || !featureOk) continue
      const { value: roll, rng: next } = randomFloat(cur)
      cur = next
      const chance = Math.max(0, Math.min(1, def.probability * density))
      if (roll < chance) traits.push(def.trait)
    }
    out.push({ ...province, traits })
  }
  return { provinces: out, rng: cur }
}

/**
 * v0.59: holding の不動産スロット上限。base（holdingKind 別）＋ Province の slot 系 trait
 * （広闊な地形など）の slotBonus 合計。worldgen・develop Project・overuse 判定で共通利用する。
 */
export function computeSlotCapacity(
  config: SimulationConfig,
  holdingKind: HoldingKind,
  traits: readonly TerrainTraitKind[],
): number {
  const base = config.realEstateSlotCapacityBase[holdingKind] ?? 3
  let bonus = 0
  for (const t of traits) {
    const def = config.terrainTraitDefinitions.find((d) => d.trait === t)
    if (def?.effect.kind === 'slot') bonus += def.effect.slotBonus
  }
  return base + bonus
}

/**
 * v0.59: holding の所属 Province の地形特性（output 効果）から、該当 resource の産出倍率を返す。
 * 複数 trait が同 resource を上げる場合は乗算。該当無しは 1.0。
 * 対象は input を持たない raw/採掘産出に限る（config 定義側で担保。加工品に掛けると
 * output>input の無償財になるため）。
 */
export function getProvinceOutputTraitMultiplier(
  state: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  resource: ResourceKind,
): number {
  const holding = state.holdings[holdingId]
  if (!holding) return 1.0
  const province = state.provinces[holding.provinceId]
  if (!province || province.traits.length === 0) return 1.0
  let mult = 1.0
  for (const t of province.traits) {
    const def = config.terrainTraitDefinitions.find((d) => d.trait === t)
    if (def?.effect.kind === 'output') {
      const r = def.effect.resources[resource]
      if (r !== undefined) mult *= r
    }
  }
  return mult
}
