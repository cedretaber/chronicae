import { describe, it, expect } from 'vitest'
import { generateWorld } from './generateWorld'
import { defaultConfig } from '../config/defaultConfig'
import { calcPolityMilitaryPower } from '../selectors/militarySelectors'
import type { PolityId } from '../types/ids'

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

  it('every infantry regiment owner is the holding terminal polity; cavalry has no home', () => {
    const { world } = generateWorld('seed-1')

    for (const r of Object.values(world.regiments)) {
      expect(r.owner.kind).toBe('polity')
      if (r.troopKind === 'infantry') {
        expect(r.homeHoldingId).toBeDefined()
        const term = world.holdingTerminalPolityCache[r.homeHoldingId!]
        expect(r.owner.id as string).toBe(term as string)
      } else {
        expect(r.homeHoldingId).toBeUndefined()
        expect(r.homeProvinceId).toBeUndefined()
      }
    }
  })

  it('per-owner infantry basePower sum equals old calcPolityMilitaryPower at t=0', () => {
    const { world } = generateWorld('seed-1')

    const sums = new Map<string, number>()
    for (const [ownerKey, ids] of Object.entries(world.regimentIndex.byOwner)) {
      let sum = 0
      for (const id of ids) {
        const r = world.regiments[id]
        if (r && r.troopKind === 'infantry') {
          sum += r.basePower
        }
      }
      sums.set(ownerKey, sum)
    }

    for (const [ownerKey, sum] of sums.entries()) {
      const [kind, idStr] = ownerKey.split(':')
      if (kind !== 'polity') continue
      const polityId = idStr as PolityId
      const oldPower = calcPolityMilitaryPower(world, defaultConfig, polityId)
      expect(sum).toBeCloseTo(oldPower, 5)
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

    // byHomeHolding total == infantry regiment count (cavalry has no homeHolding)
    let byHomeHoldingTotal = 0
    for (const ids of Object.values(world.regimentIndex.byHomeHolding)) {
      byHomeHoldingTotal += ids.length
    }
    const infantryCount = Object.values(world.regiments).filter(
      (r) => r.troopKind === 'infantry',
    ).length
    expect(byHomeHoldingTotal).toBe(infantryCount)

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
