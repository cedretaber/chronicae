import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runRegimentRecoverySystem } from './regimentRecoverySystem'
import { createRegiment } from '../mutations/regimentMutations'
import type { WorldState } from '../types/world'
import type { PolityId, RegimentId } from '../types/ids'

const PO1: PolityId = 'dp-1' as PolityId

function ctx(state: WorldState) {
  return createTickContext({ state, rng: createRng('rec'), config: defaultConfig })
}

// v0.37: baseline-aware recovery. defaults: baselineOrg 50 / baselineMorale 30 / maxOrg 100 / maxMorale 100.
//   morale defaults to baseline (30) so a regiment created "at rest" needs no recovery.
function addReg(
  state: WorldState,
  organization: number,
  opts: {
    status?: 'active' | 'disbanded'
    strength?: number
    morale?: number
    baselineOrganization?: number
    baselineMorale?: number
    maxOrganization?: number
  } = {},
): ReturnType<typeof createRegiment> {
  const r = createRegiment(state, {
    owner: { kind: 'polity' as const, id: PO1 },
    sourceKind: 'levy',
    troopKind: 'infantry',
    strength: opts.strength ?? 100,
    organization,
    morale: opts.morale ?? 30,
    maxStrength: 100,
    basePower: 100,
    baselineOrganization: opts.baselineOrganization ?? 50,
    maxOrganization: opts.maxOrganization ?? 100,
    baselineMorale: opts.baselineMorale ?? 30,
    maxMorale: 100,
    createdWeek: 0,
  })
  if (opts.status === 'disbanded') {
    state.regiments[r.id] = { ...state.regiments[r.id]!, status: 'disbanded' }
  }
  return r
}

describe('runRegimentRecoverySystem (baseline-aware)', () => {
  it('org below baseline recovers toward baseline using morale at tick start', () => {
    // org=20 (<50), morale=80 → recovery 8*(0.5+0.8)=10.4 → 30.4. morale 80 decays 0.5 → 79.5.
    const state = makeEmptyV016State()
    addReg(state, 20, { morale: 80 })
    const out = runRegimentRecoverySystem(ctx(state))
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBeCloseTo(30.4, 5)
    expect(r.morale).toBeCloseTo(79.5, 5)
    expect(r.strength).toBe(100)
  })

  it('org recovery caps at baseline (does not overshoot)', () => {
    // org=48 (<50), morale=30 → recovery 8*(0.5+0.3)=6.4 → min(50, 54.4)=50.
    const state = makeEmptyV016State()
    addReg(state, 48)
    const out = runRegimentRecoverySystem(ctx(state))
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBe(50)
    expect(r.morale).toBe(30) // at baseline → unchanged
  })

  it('org above baseline decays toward baseline', () => {
    // org=100 (>50) → decay 1 → 99. morale 30 at baseline → unchanged.
    const state = makeEmptyV016State()
    addReg(state, 100)
    const out = runRegimentRecoverySystem(ctx(state))
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBe(99)
    expect(r.morale).toBe(30)
  })

  it('org decay caps at baseline', () => {
    // org=50.5 → decay 1 → max(50, 49.5)=50.
    const state = makeEmptyV016State()
    addReg(state, 50.5)
    const out = runRegimentRecoverySystem(ctx(state))
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBe(50)
  })

  it('morale recovers toward baseline independently of organization', () => {
    // org=50 (at baseline), morale=10 (<30) → recovery 1 → 11.
    const state = makeEmptyV016State()
    addReg(state, 50, { morale: 10 })
    const out = runRegimentRecoverySystem(ctx(state))
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBe(50)
    expect(r.morale).toBe(11)
  })

  it('morale above baseline decays toward baseline', () => {
    // org=50, morale=80 (>30) → decay 0.5 → 79.5.
    const state = makeEmptyV016State()
    addReg(state, 50, { morale: 80 })
    const out = runRegimentRecoverySystem(ctx(state))
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.morale).toBeCloseTo(79.5, 5)
  })

  it('at rest (org=baseline, morale=baseline) is skipped (same state reference)', () => {
    const state = makeEmptyV016State()
    addReg(state, 50, { morale: 30 })
    const input = ctx(state)
    const out = runRegimentRecoverySystem(input)
    expect(out.state).toBe(input.state)
  })

  it('disbanded regiment is skipped', () => {
    const state = makeEmptyV016State()
    addReg(state, 20, { status: 'disbanded' })
    const out = runRegimentRecoverySystem(ctx(state))
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBe(20)
    expect(r.status).toBe('disbanded')
  })

  it('empty world is a no-op', () => {
    const state = makeEmptyV016State()
    const input = ctx(state)
    const out = runRegimentRecoverySystem(input)
    expect(out.state).toBe(input.state)
  })
})
