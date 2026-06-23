import { describe, it, expect } from 'vitest'
import { generateProvinces } from './generateProvinces'
import { createRng } from '../rng/rng'
import { defaultMapConfig } from './mapConfig'
import { WORLD_PRESETS } from './worldPresets'

describe('v0.59 地形カバレッジ保証', () => {
  it('tiny で全5地形が最低1つ出現する', () => {
    for (const seed of ['s1', 's2', 's3', 's4']) {
      const { provinces } = generateProvinces(createRng(seed), defaultMapConfig, WORLD_PRESETS.tiny)
      const terrains = new Set(provinces.map((p) => p.terrain))
      expect(terrains).toEqual(new Set(['plains', 'forest', 'hills', 'mountains', 'wetlands']))
    }
  })
  it('同 seed で決定的 (terrain 配列が一致)', () => {
    const a = generateProvinces(createRng('det'), defaultMapConfig, WORLD_PRESETS.tiny)
    const b = generateProvinces(createRng('det'), defaultMapConfig, WORLD_PRESETS.tiny)
    expect(a.provinces.map((p) => p.terrain)).toEqual(b.provinces.map((p) => p.terrain))
  })
})
