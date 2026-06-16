import { describe, it, expect } from 'vitest'
import {
  computeHoldingOccupationCapacity,
  canBuildHoldingImprovementPure,
  conditionEffectiveness,
} from './holdingImprovementSelectors'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HoldingImprovementKind } from '../types/holdingImprovement'

// v0.33 §6.4 / §9.1 の純粋 helper の単体テスト。
// 期待値は defaultConfig の値（manor base agriculture=80 / urban_labor=8 / elite_service=3、
// field_system capacityPerLevel agriculture=60 / terrainMult plains=1.3 mountains=0.25 /
// featureMult major_river=1.1）に基づき手計算したもの。

const cfg = defaultConfig
type Imp = { kind: HoldingImprovementKind; level: number; condition: number }
const noImp: Imp[] = []

describe('computeHoldingOccupationCapacity', () => {
  it('base only (improvement 無し): manor agriculture = base * weight * landQuality', () => {
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      [],
      noImp,
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(80)
  })

  it("occupation === 'none' は常に 0", () => {
    const cap = computeHoldingOccupationCapacity(
      'manor',
      2,
      1.4,
      'plains',
      ['major_river'],
      [{ kind: 'field_system', level: 3, condition: 100 }],
      cfg,
      'none',
    )
    expect(cap).toBe(0)
  })

  it('improvement-derived capacity が base に加算される (field_system L1, plains, feature 無)', () => {
    // base 80 + (level1 * 60 * terrain(plains=1.3) * feature(空積=1.0)) = 80 + 78 = 158
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      [],
      [{ kind: 'field_system', level: 1, condition: 100 }],
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(158)
  })

  it('weight と landQuality が最終的に乗算される', () => {
    // (80 + 78) * weight(2) * landQuality(0.5) = 158
    const cap = computeHoldingOccupationCapacity(
      'manor',
      2,
      0.5,
      'plains',
      [],
      [{ kind: 'field_system', level: 1, condition: 100 }],
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(158)
  })

  it('terrain multiplier が効く (field_system L1, mountains=0.25)', () => {
    // 80 + (60 * 0.25 * 1.0) = 80 + 15 = 95
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'mountains',
      [],
      [{ kind: 'field_system', level: 1, condition: 100 }],
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(95)
  })

  it('feature multiplier が効く (field_system L1, plains + major_river=1.1)', () => {
    // 80 + (60 * 1.3 * 1.1) = 80 + 85.8 = 165.8
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      ['major_river'],
      [{ kind: 'field_system', level: 1, condition: 100 }],
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(165.8)
  })

  it('capacityPerLevel 未定義の occupation には improvement が寄与しない', () => {
    // field_system は urban_labor の枠を生まない → base(8) のみ
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      [],
      [{ kind: 'field_system', level: 3, condition: 100 }],
      cfg,
      'urban_labor',
    )
    expect(cap).toBeCloseTo(8)
  })

  it('production_quality 設備 (storage) は capacity を生まない', () => {
    // storage は capacityPerLevel が空 → derived 0 → base(80) のみ
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      [],
      [{ kind: 'storage_infrastructure', level: 3, condition: 100 }],
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(80)
  })

  it('featureMultiplier は上限 1.5 で clamp される', () => {
    const customCfg: SimulationConfig = {
      ...cfg,
      holdingImprovementFeatureCapacityMultiplier: {
        ...cfg.holdingImprovementFeatureCapacityMultiplier,
        field_system: { coastal: 3.0 },
      },
    }
    // featureMult = clamp(3.0, 0.75, 1.5) = 1.5 → 80 + (60 * 1.3 * 1.5) = 80 + 117 = 197
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      ['coastal'],
      [{ kind: 'field_system', level: 1, condition: 100 }],
      customCfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(197)
  })

  it('featureMultiplier は下限 0.75 で clamp される', () => {
    const customCfg: SimulationConfig = {
      ...cfg,
      holdingImprovementFeatureCapacityMultiplier: {
        ...cfg.holdingImprovementFeatureCapacityMultiplier,
        field_system: { coastal: 0.1 },
      },
    }
    // featureMult = clamp(0.1, 0.75, 1.5) = 0.75 → 80 + (60 * 1.3 * 0.75) = 80 + 58.5 = 138.5
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      ['coastal'],
      [{ kind: 'field_system', level: 1, condition: 100 }],
      customCfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(138.5)
  })

  it('複数 improvement の derived は合算される (market: urban_labor + elite_service)', () => {
    // city base urban_labor=70 + (workshop L1: 65 * terrain(plains workshop=1.0) * 1.0) = 70 + 65 = 135
    const cap = computeHoldingOccupationCapacity(
      'city',
      1,
      1,
      'plains',
      [],
      [{ kind: 'workshop_infrastructure', level: 1, condition: 100 }],
      cfg,
      'urban_labor',
    )
    expect(cap).toBeCloseTo(135)
  })
})

describe('conditionEffectiveness (v0.48.1 §3)', () => {
  it('閾値以上は full (1.0)', () => {
    expect(conditionEffectiveness(100, 50, 0)).toBe(1)
    expect(conditionEffectiveness(50, 50, 0)).toBe(1)
  })

  it('閾値未満は線形低下 (condition / threshold)', () => {
    expect(conditionEffectiveness(25, 50, 0)).toBeCloseTo(0.5)
    expect(conditionEffectiveness(10, 50, 0)).toBeCloseTo(0.2)
  })

  it('minFloor で下限が効く', () => {
    expect(conditionEffectiveness(5, 50, 0.3)).toBeCloseTo(0.3)
    expect(conditionEffectiveness(0, 50, 0.3)).toBeCloseTo(0.3)
  })

  it('condition 0 で minFloor=0 なら 0', () => {
    expect(conditionEffectiveness(0, 50, 0)).toBe(0)
  })
})

describe('computeHoldingOccupationCapacity: 機能不全で derived capacity が低下する (v0.48.1 §3)', () => {
  it('閾値割れ improvement は derived 寄与が effectiveness 倍になる', () => {
    // field_system L1 plains: base 80 + 78 * eff。condition 25 (threshold 50) → eff 0.5 → 80 + 39 = 119
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      [],
      [{ kind: 'field_system', level: 1, condition: 25 }],
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(119)
  })

  it('condition 0 (minFloor 0) は derived 寄与が消え base のみ', () => {
    const cap = computeHoldingOccupationCapacity(
      'manor',
      1,
      1,
      'plains',
      [],
      [{ kind: 'field_system', level: 1, condition: 0 }],
      cfg,
      'agriculture',
    )
    expect(cap).toBeCloseTo(80)
  })
})

describe('canBuildHoldingImprovementPure', () => {
  it('field_system: manor + 許可 terrain (plains) は建設可', () => {
    expect(canBuildHoldingImprovementPure('manor', 'plains', [], 0, 'field_system', cfg)).toBe(true)
  })

  it('field_system: city では建設不可 (allowedHoldingKinds=manor)', () => {
    expect(canBuildHoldingImprovementPure('city', 'plains', [], 0, 'field_system', cfg)).toBe(false)
  })

  it('field_system: mountains では建設不可 (allowedTerrains 外)', () => {
    expect(canBuildHoldingImprovementPure('manor', 'mountains', [], 0, 'field_system', cfg)).toBe(
      false,
    )
  })

  it('field_system: currentLevel が maxLevel(3) 到達済みなら不可', () => {
    expect(canBuildHoldingImprovementPure('manor', 'plains', [], 3, 'field_system', cfg)).toBe(
      false,
    )
  })

  it('irrigation: feature 無しでは建設不可 (requiredAnyFeatures)', () => {
    expect(
      canBuildHoldingImprovementPure('manor', 'plains', [], 0, 'irrigation_infrastructure', cfg),
    ).toBe(false)
  })

  it('irrigation: major_river があれば建設可', () => {
    expect(
      canBuildHoldingImprovementPure(
        'manor',
        'plains',
        ['major_river'],
        0,
        'irrigation_infrastructure',
        cfg,
      ),
    ).toBe(true)
  })

  it('irrigation: lake があれば建設可', () => {
    expect(
      canBuildHoldingImprovementPure(
        'manor',
        'plains',
        ['lake'],
        0,
        'irrigation_infrastructure',
        cfg,
      ),
    ).toBe(true)
  })

  it('market: city は建設可 / manor は不可', () => {
    expect(
      canBuildHoldingImprovementPure('city', 'plains', [], 0, 'market_infrastructure', cfg),
    ).toBe(true)
    expect(
      canBuildHoldingImprovementPure('manor', 'plains', [], 0, 'market_infrastructure', cfg),
    ).toBe(false)
  })

  it('storage: allowedTerrains 未指定 → 全 terrain 許可 (mountains でも可)', () => {
    expect(
      canBuildHoldingImprovementPure('manor', 'mountains', [], 0, 'storage_infrastructure', cfg),
    ).toBe(true)
  })

  it('maxLevel 未定義/0 の組合せ (city の field_system) は不可', () => {
    // maxLevelByKind.field_system.city = 0 → 建設不可
    expect(canBuildHoldingImprovementPure('city', 'plains', [], 0, 'field_system', cfg)).toBe(false)
  })
})
