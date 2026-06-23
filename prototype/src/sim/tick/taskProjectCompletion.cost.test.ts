import { describe, it, expect } from 'vitest'
import { computeImprovementProjectCost } from './taskProjectCompletion'
import { defaultConfig } from '../config/defaultConfig'
import type { Province } from '../types/province'
import type { ProvinceTerrain, ProvinceFeature } from '../types/province'

// v0.59 追補③: 改良コストの地形/地物割引を検証する。computeImprovementProjectCost は
//   province.terrain / province.features のみを読む純関数なので最小 Province でテストする。
function mkProvince(terrain: ProvinceTerrain, features: ProvinceFeature[]): Province {
  return { terrain, features } as Province
}

const cfg = defaultConfig

describe('computeImprovementProjectCost (v0.59 追補③ 灌漑コスト割引)', () => {
  const base = cfg.developHoldingProjectBaseCostByImprovementKind.irrigation_infrastructure
  const margin = cfg.projectBudgetMarginMultiplier
  const levelMult = cfg.improvementLevelCostMultiplier[1] ?? 1
  const fullCost = base * levelMult * margin // 割引なしの基準 (level 1)

  it('plains・feature 無し → 割引なし (乗数 1.0)', () => {
    const p = mkProvince('plains', [])
    expect(computeImprovementProjectCost(cfg, p, 'irrigation_infrastructure', 1)).toBeCloseTo(
      fullCost,
    )
  })

  it('wetlands 地形 → terrain 乗数 0.8', () => {
    const p = mkProvince('wetlands', [])
    expect(computeImprovementProjectCost(cfg, p, 'irrigation_infrastructure', 1)).toBeCloseTo(
      fullCost * 0.8,
    )
  })

  it('major_river feature → feature 乗数 0.8', () => {
    const p = mkProvince('plains', ['major_river'])
    expect(computeImprovementProjectCost(cfg, p, 'irrigation_infrastructure', 1)).toBeCloseTo(
      fullCost * 0.8,
    )
  })

  it('lake feature → feature 乗数 0.85', () => {
    const p = mkProvince('plains', ['lake'])
    expect(computeImprovementProjectCost(cfg, p, 'irrigation_infrastructure', 1)).toBeCloseTo(
      fullCost * 0.85,
    )
  })

  it('coastal (海) feature → 割引なし', () => {
    const p = mkProvince('plains', ['coastal'])
    expect(computeImprovementProjectCost(cfg, p, 'irrigation_infrastructure', 1)).toBeCloseTo(
      fullCost,
    )
  })

  it('wetlands + major_river → terrain × feature の乗算 (0.8 × 0.8)', () => {
    const p = mkProvince('wetlands', ['major_river'])
    expect(computeImprovementProjectCost(cfg, p, 'irrigation_infrastructure', 1)).toBeCloseTo(
      fullCost * 0.8 * 0.8,
    )
  })

  it('level 乗数も反映 (level 2 = ×2)', () => {
    const p = mkProvince('plains', [])
    const l2 = base * (cfg.improvementLevelCostMultiplier[2] ?? 1) * margin
    expect(computeImprovementProjectCost(cfg, p, 'irrigation_infrastructure', 2)).toBeCloseTo(l2)
  })

  it('割引未定義の改良 (storage) は地形/地物に関わらず割引なし', () => {
    const p = mkProvince('wetlands', ['major_river', 'lake'])
    const storageBase = cfg.developHoldingProjectBaseCostByImprovementKind.storage_infrastructure
    expect(computeImprovementProjectCost(cfg, p, 'storage_infrastructure', 1)).toBeCloseTo(
      storageBase * levelMult * margin,
    )
  })
})
