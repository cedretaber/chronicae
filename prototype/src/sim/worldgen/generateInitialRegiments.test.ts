import { describe, it, expect } from 'vitest'
import { generateWorld } from './generateWorld'
import { defaultConfig } from '../config/defaultConfig'
import { calcPolityMilitaryPower } from '../selectors/militarySelectors'
import { getRegimentEffectivePower } from '../selectors/regimentSelectors'
import type { PolityId } from '../types/ids'

// ---------------------------------------------------------------------------
// generateInitialRegiments (via generateWorld)
// ---------------------------------------------------------------------------

describe('generateInitialRegiments (via generateWorld)', () => {
  it('generates exactly one regiment per holding', () => {
    const { world } = generateWorld('seed-1')

    const regimentCount = Object.keys(world.regiments).length
    const holdingCount = Object.keys(world.holdings).length

    expect(regimentCount).toBe(holdingCount)
    expect(regimentCount).toBeGreaterThan(0)
  })

  it('every regiment owner is the holding terminal polity', () => {
    const { world } = generateWorld('seed-1')

    for (const r of Object.values(world.regiments)) {
      expect(r.owner.kind).toBe('polity')
      expect(r.homeHoldingId).toBeDefined()
      const term = world.holdingTerminalPolityCache[r.homeHoldingId!]
      expect(r.owner.id as string).toBe(term as string)
    }
  })

  it('per-owner basePower sum equals old calcPolityMilitaryPower at t=0', () => {
    const { world } = generateWorld('seed-1')

    // Build Map<ownerKey, sum of effective power> from regimentIndex.byOwner
    const sums = new Map<string, number>()
    for (const [ownerKey, ids] of Object.entries(world.regimentIndex.byOwner)) {
      let sum = 0
      for (const id of ids) {
        const r = world.regiments[id]
        if (r) {
          sum += getRegimentEffectivePower(r)
        }
      }
      sums.set(ownerKey, sum)
    }

    // Compare each owner's sum to calcPolityMilitaryPower
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

    // byHomeHolding total == regiment count
    let byHomeHoldingTotal = 0
    for (const ids of Object.values(world.regimentIndex.byHomeHolding)) {
      byHomeHoldingTotal += ids.length
    }
    expect(byHomeHoldingTotal).toBe(Object.keys(world.regiments).length)

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
