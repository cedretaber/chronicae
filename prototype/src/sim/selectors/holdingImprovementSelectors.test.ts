import { describe, it, expect } from 'vitest'
import {
  canBuildHoldingImprovementPure,
  canBuildRealEstateAssetPure,
  conditionEffectiveness,
} from './holdingImprovementSelectors'
import { defaultConfig } from '../config/defaultConfig'

// v0.52: base capacity はゼロ化、improvement は infrastructure 専用 (capacity を直接生まない)。
// capacity テストは Phase 2 で RealEstateAsset ベースに全面書き換えする。
// Phase 1 では canBuildHoldingImprovementPure と conditionEffectiveness のテストのみ維持。

const cfg = defaultConfig

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

describe('canBuildHoldingImprovementPure', () => {
  it('transport_infrastructure: manor + plains は建設可', () => {
    expect(
      canBuildHoldingImprovementPure('manor', 'plains', [], 0, 'transport_infrastructure', cfg),
    ).toBe(true)
  })

  it('irrigation_infrastructure: city では建設不可 (allowedHoldingKinds=manor)', () => {
    expect(
      canBuildHoldingImprovementPure('city', 'plains', [], 0, 'irrigation_infrastructure', cfg),
    ).toBe(false)
  })

  it('transport_infrastructure: currentLevel が maxLevel(3) 到達済みなら不可', () => {
    expect(
      canBuildHoldingImprovementPure('manor', 'plains', [], 3, 'transport_infrastructure', cfg),
    ).toBe(false)
  })

  // v0.59 追補③: 灌漑は地形/feature ゲートを撤去。河川/湖沼でも建設可 (もはや必須ではないが許可される)。
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
})

describe('v0.59 農園どこでも', () => {
  it('farm は mountains でも建設可能', () => {
    expect(canBuildRealEstateAssetPure('manor', 'mountains', [], 'farm')).toBe(true)
  })
  it('farm は従来地形でも建設可能 (plains)', () => {
    expect(canBuildRealEstateAssetPure('manor', 'plains', [], 'farm')).toBe(true)
  })
})

describe('v0.59 追補③ 灌漑 degate', () => {
  it('irrigation は河川/湖沼が無い plains の manor でも建設可 (旧 requiredAnyFeatures 撤去)', () => {
    expect(
      canBuildHoldingImprovementPure('manor', 'plains', [], 0, 'irrigation_infrastructure', cfg),
    ).toBe(true)
  })
  it('irrigation は mountains の manor でも建設可 (旧 allowedTerrains 撤去)', () => {
    expect(
      canBuildHoldingImprovementPure('manor', 'mountains', [], 0, 'irrigation_infrastructure', cfg),
    ).toBe(true)
  })
  it('irrigation は city には建てられない (allowedHoldingKinds=manor 維持)', () => {
    expect(
      canBuildHoldingImprovementPure('city', 'plains', [], 0, 'irrigation_infrastructure', cfg),
    ).toBe(false)
  })
})
