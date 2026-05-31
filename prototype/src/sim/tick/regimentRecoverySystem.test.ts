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

// create one regiment with given organization (morale fixed 80); returns the Regiment
function addReg(
  state: WorldState,
  organization: number,
  opts: { status?: 'active' | 'disbanded'; strength?: number } = {},
): ReturnType<typeof createRegiment> {
  const r = createRegiment(state, {
    owner: { kind: 'polity' as const, id: PO1 },
    sourceKind: 'levy',
    troopKind: 'infantry',
    strength: opts.strength ?? 100,
    organization,
    morale: 80,
    maxStrength: 100,
    basePower: 100,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
  })
  if (opts.status === 'disbanded') {
    state.regiments[r.id] = { ...state.regiments[r.id]!, status: 'disbanded' }
  }
  return r
}

describe('runRegimentRecoverySystem', () => {
  it('active org=50, morale=80 recovers by 8*(0.5+0.8)=10.4 -> 60.4', () => {
    const state = makeEmptyV016State()
    addReg(state, 50)
    const input = ctx(state)
    const out = runRegimentRecoverySystem(input)
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBeCloseTo(60.4, 5)
    expect(r.strength).toBe(100)
  })

  it('recovery clamps at 100', () => {
    const state = makeEmptyV016State()
    addReg(state, 98)
    const input = ctx(state)
    const out = runRegimentRecoverySystem(input)
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBe(100)
  })

  it('disbanded regiment is skipped', () => {
    const state = makeEmptyV016State()
    addReg(state, 50, { status: 'disbanded' })
    const input = ctx(state)
    const out = runRegimentRecoverySystem(input)
    const r = out.state.regiments['rg-0' as RegimentId]!
    expect(r.organization).toBe(50)
    expect(r.status).toBe('disbanded')
  })

  it('active org=100 is skipped (same state reference)', () => {
    const state = makeEmptyV016State()
    addReg(state, 100)
    const input = ctx(state)
    const out = runRegimentRecoverySystem(input)
    expect(out.state).toBe(input.state)
  })

  it('empty world is a no-op', () => {
    const state = makeEmptyV016State()
    const input = ctx(state)
    const out = runRegimentRecoverySystem(input)
    expect(out.state).toBe(input.state)
  })
})
