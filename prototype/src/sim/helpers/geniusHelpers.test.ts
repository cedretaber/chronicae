// v0.45 天才: ロール・天賦引き上げ・初期値引き上げのユニットテスト。

import { describe, expect, it } from 'vitest'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import type { AbilityScores } from '../types/person'
import { createRng } from '../rng/rng'
import { ABILITY_KEYS } from '../constants/abilityConstants'
import {
  GENIUS_ABILITY_SETS,
  rollGeniusType,
  applyGeniusAptitudes,
  applyGeniusInitialAbilities,
} from './geniusHelpers'

function makeConfig(overrides: Partial<SimulationConfig>): SimulationConfig {
  return { ...defaultConfig, ...overrides }
}

function makeScores(value: number): AbilityScores {
  return {
    valor: value,
    command: value,
    numeracy: value,
    learning: value,
    charisma: value,
    insight: value,
  }
}

describe('rollGeniusType', () => {
  it('chance 0 では出現せず RNG も消費しない', () => {
    const rng = createRng('genius-test')
    const config = makeConfig({ geniusAppearanceChance: 0 })
    const result = rollGeniusType(rng, config)
    expect(result.value).toBeUndefined()
    expect(result.rng).toBe(rng)
  })

  it('chance 1 では必ず出現する', () => {
    let rng = createRng('genius-test')
    const config = makeConfig({ geniusAppearanceChance: 1 })
    for (let i = 0; i < 20; i++) {
      const result = rollGeniusType(rng, config)
      expect(result.value).toBeDefined()
      rng = result.rng
    }
  })

  it('weight が 1 型だけ正なら常にその型になる (正規化の検証)', () => {
    let rng = createRng('genius-test')
    const config = makeConfig({
      geniusAppearanceChance: 1,
      geniusTypeWeightCommander: 0,
      geniusTypeWeightChancellor: 0,
      geniusTypeWeightUniversal: 7, // 合計 1 でなくてもよい
    })
    for (let i = 0; i < 10; i++) {
      const result = rollGeniusType(rng, config)
      expect(result.value).toBe('universal')
      rng = result.rng
    }
  })

  it('weight 合計が 0 以下なら出現しない', () => {
    const rng = createRng('genius-test')
    const config = makeConfig({
      geniusAppearanceChance: 1,
      geniusTypeWeightCommander: 0,
      geniusTypeWeightChancellor: 0,
      geniusTypeWeightUniversal: 0,
    })
    expect(rollGeniusType(rng, config).value).toBeUndefined()
  })
})

describe('applyGeniusAptitudes', () => {
  it('対象能力は必ず geniusAptitudeMin 以上になり、対象外は変わらない', () => {
    let rng = createRng('genius-apt')
    for (let i = 0; i < 20; i++) {
      const result = applyGeniusAptitudes(makeScores(30), 'commander', rng, defaultConfig)
      for (const k of GENIUS_ABILITY_SETS.commander) {
        expect(result.value[k]).toBeGreaterThanOrEqual(defaultConfig.geniusAptitudeMin)
        expect(result.value[k]).toBeLessThanOrEqual(defaultConfig.geniusAptitudeMax)
      }
      expect(result.value.numeracy).toBe(30)
      expect(result.value.learning).toBe(30)
      expect(result.value.insight).toBe(30)
      rng = result.rng
    }
  })

  it('既存値がロール上限より高い場合は潰さない (max の床として働く)', () => {
    const rng = createRng('genius-apt')
    const config = makeConfig({ geniusAptitudeMin: 80, geniusAptitudeMax: 80 })
    const result = applyGeniusAptitudes(makeScores(95), 'chancellor', rng, config)
    for (const k of GENIUS_ABILITY_SETS.chancellor) {
      expect(result.value[k]).toBe(95)
    }
  })

  it('universal は全 6 能力に効く', () => {
    const rng = createRng('genius-apt')
    const result = applyGeniusAptitudes(makeScores(10), 'universal', rng, defaultConfig)
    for (const k of ABILITY_KEYS) {
      expect(result.value[k]).toBeGreaterThanOrEqual(defaultConfig.geniusAptitudeMin)
    }
  })
})

describe('applyGeniusInitialAbilities', () => {
  it('対象能力を初期値まで引き上げ、対象外と高い既存値はそのまま', () => {
    const abilities = { ...makeScores(5), valor: 70 }
    const aptitudes = makeScores(100)
    const result = applyGeniusInitialAbilities(abilities, aptitudes, 'commander', defaultConfig)
    expect(result.valor).toBe(70) // 既に初期値超え → 据え置き
    expect(result.command).toBe(defaultConfig.geniusInitialAbilityValue)
    expect(result.charisma).toBe(defaultConfig.geniusInitialAbilityValue)
    expect(result.numeracy).toBe(5) // 対象外
  })

  it('天賦が初期値より低い場合は天賦で clamp する', () => {
    const config = makeConfig({ geniusInitialAbilityValue: 50, geniusAptitudeMin: 40 })
    const aptitudes = { ...makeScores(100), command: 42 }
    const result = applyGeniusInitialAbilities(makeScores(0), aptitudes, 'commander', config)
    expect(result.command).toBe(42)
    expect(result.valor).toBe(50)
  })
})
