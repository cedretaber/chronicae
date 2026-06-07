// v0.45: samplePerson の天才経路のテスト。

import { describe, expect, it } from 'vitest'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createPersonId } from '../types/ids'
import { createRng } from '../rng/rng'
import { GENIUS_ABILITY_SETS } from './geniusHelpers'
import { samplePerson } from './personFactory'

function makeConfig(overrides: Partial<SimulationConfig>): SimulationConfig {
  return { ...defaultConfig, ...overrides }
}

function sample(config: SimulationConfig, seed: string) {
  return samplePerson(createRng(seed), config, {
    id: createPersonId('pe', 0),
    nameKey: 'test-person',
    sex: 'male',
    age: 0,
    birthStatus: 'unknown',
    traits: { ambition: 0.5, caution: 0.5 },
  }).value
}

describe('samplePerson genius 経路', () => {
  it('chance 0 では geniusType が立たない', () => {
    const person = sample(makeConfig({ geniusAppearanceChance: 0 }), 'factory-test')
    expect(person.geniusType).toBeUndefined()
  })

  it('chance 1 では geniusType が立ち、対象能力の天賦と初期値が引き上がる', () => {
    const config = makeConfig({ geniusAppearanceChance: 1 })
    const person = sample(config, 'factory-test')
    expect(person.geniusType).toBeDefined()
    const keys = GENIUS_ABILITY_SETS[person.geniusType!]
    for (const k of keys) {
      expect(person.aptitudes[k]).toBeGreaterThanOrEqual(config.geniusAptitudeMin)
      // age 0 のサンプル能力はほぼ 0 → 初期値まで引き上がっている
      expect(person.abilities[k]).toBeGreaterThanOrEqual(
        Math.min(config.geniusInitialAbilityValue, person.aptitudes[k]),
      )
    }
  })
})
