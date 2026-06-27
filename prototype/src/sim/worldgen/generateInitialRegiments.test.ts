import { describe, it, expect } from 'vitest'
import { generateWorld } from './generateWorld'

// ---------------------------------------------------------------------------
// generateInitialRegiments (via generateWorld)
// ---------------------------------------------------------------------------

describe('generateInitialRegiments (via generateWorld)', () => {
  it('generates one infantry regiment per holding plus cavalry for eligible polities', () => {
    const { world } = generateWorld('seed-1')

    const infantryCount = Object.values(world.regiments).filter(
      (r) => r.troopKind === 'infantry',
    ).length
    const cavalryCount = Object.values(world.regiments).filter(
      (r) => r.troopKind === 'cavalry',
    ).length
    const holdingCount = Object.keys(world.holdings).length

    expect(infantryCount).toBe(holdingCount)
    expect(cavalryCount).toBeGreaterThan(0)
    expect(infantryCount + cavalryCount).toBe(Object.keys(world.regiments).length)
  })

  it('every regiment has barracks; infantry owner matches holding terminal polity', () => {
    const { world } = generateWorld('seed-1')

    for (const r of Object.values(world.regiments)) {
      expect(r.owner.kind).toBe('polity')
      const barracks = world.regimentBarracks[r.barracksId]
      expect(barracks).toBeDefined()
      if (r.troopKind === 'infantry' && barracks) {
        const term = world.holdingTerminalPolityCache[barracks.holdingId]
        expect(r.owner.id as string).toBe(term as string)
      }
    }
  })

  it('indexes are consistent and basePower finite', () => {
    const { world } = generateWorld('seed-1')

    // byOwner total entries == regiment count
    let byOwnerTotal = 0
    for (const ids of Object.values(world.regimentIndex.byOwner)) {
      byOwnerTotal += ids.length
    }
    expect(byOwnerTotal).toBe(Object.keys(world.regiments).length)

    // regimentBarracksIndex.byHolding total == regiment count (every regiment has a barracks)
    let byHoldingTotal = 0
    for (const ids of Object.values(world.regimentBarracksIndex.byHolding)) {
      byHoldingTotal += ids.length
    }
    expect(byHoldingTotal).toBe(Object.keys(world.regiments).length)

    // every regiment basePower is finite and >= 0
    for (const r of Object.values(world.regiments)) {
      expect(Number.isFinite(r.basePower)).toBe(true)
      expect(r.basePower).toBeGreaterThanOrEqual(0)
    }
  })

  it('regiment count is independent of holdings drift (gen-only): regenerate same seed gives same count', () => {
    const { world: w1 } = generateWorld('seed-1')
    const { world: w2 } = generateWorld('seed-1')

    expect(Object.keys(w1.regiments).length).toBe(Object.keys(w2.regiments).length)
  })
})
