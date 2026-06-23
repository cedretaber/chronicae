import { describe, it, expect } from 'vitest'
import { assignTerrainTraits } from './terrainTraitSelectors'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import type { Province } from '../types/province'

const prov = (
  id: string,
  terrain: Province['terrain'],
  features: Province['features'] = [],
): Province => ({
  id: id as Province['id'],
  stateId: 's1' as Province['stateId'],
  nameKey: 'n',
  x: 0,
  y: 0,
  neighbors: [],
  terrain,
  features,
  traits: [],
  holdingIds: [],
})

describe('v0.59 assignTerrainTraits', () => {
  it('地形に適合した trait のみ付与される', () => {
    const provs = [prov('p1', 'mountains'), prov('p2', 'forest')]
    const { provinces } = assignTerrainTraits(provs, defaultConfig, createRng('t'))
    // mountains は rich_lode を持ちうるが dense_forest は持たない
    expect(provinces[0]!.traits.every((t) => t !== 'dense_forest')).toBe(true)
    // forest は dense_forest を持ちうるが rich_lode は持たない
    expect(provinces[1]!.traits.every((t) => t !== 'rich_lode')).toBe(true)
  })
  it('内陸 (feature 無し) には rich_fishery が付かない', () => {
    const provs = [prov('p1', 'plains')]
    const { provinces } = assignTerrainTraits(provs, defaultConfig, createRng('inland'))
    expect(provinces[0]!.traits.includes('rich_fishery')).toBe(false)
  })
  it('同 seed で決定的', () => {
    const mk = () => [prov('p1', 'plains', ['coastal']), prov('p2', 'hills')]
    const a = assignTerrainTraits(mk(), defaultConfig, createRng('d'))
    const b = assignTerrainTraits(mk(), defaultConfig, createRng('d'))
    expect(a.provinces.map((p) => p.traits)).toEqual(b.provinces.map((p) => p.traits))
  })
  it('density 0 で trait が一切付かない', () => {
    const cfg = { ...defaultConfig, terrainTraitDensityMultiplier: 0 }
    const provs = [prov('p1', 'plains', ['coastal']), prov('p2', 'mountains')]
    const { provinces } = assignTerrainTraits(provs, cfg, createRng('z'))
    expect(provinces.every((p) => p.traits.length === 0)).toBe(true)
  })
})
