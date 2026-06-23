import type { Province, TerrainTraitKind } from '../types/province'
import type { SimulationConfig } from '../config/defaultConfig'
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
