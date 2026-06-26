import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import {
  createRegimentWithBarracksMut,
  regimentOwnerSyncTarget,
  syncRegimentOwnerToHomeTerminalMut,
  updateRegimentMut,
} from './regimentMutations'
import { organizationKey } from '../selectors/organizationSelectors'
import type { WorldState } from '../types/world'
import type { PolityId, HoldingId } from '../types/ids'

const po1 = 'po-1' as PolityId
const po2 = 'po-2' as PolityId
const hl1 = 'hl-1' as HoldingId

function makeReg(
  state: WorldState,
  owner: { kind: 'polity'; id: PolityId } = { kind: 'polity', id: po1 },
) {
  const { regiment } = createRegimentWithBarracksMut(state, {
    owner,
    sourceKind: 'levy',
    troopKind: 'infantry',
    holdingId: hl1,
    requiredByPopType: {},
    strength: 100,
    organization: 100,
    morale: 80,
    maxStrength: 100,
    basePower: 100,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
  })
  return regiment
}

// ---------------------------------------------------------------------------
// regimentOwnerSyncTarget
// ---------------------------------------------------------------------------

describe('regimentOwnerSyncTarget', () => {
  it('returns terminal polity id when owner differs from home terminal', () => {
    const state = makeEmptyV016State()
    const reg = makeReg(state, { kind: 'polity', id: po1 })

    state.holdingTerminalPolityCache[hl1] = po2

    const result = regimentOwnerSyncTarget(state, reg)
    expect(result).toBe('po-2')
  })

  it('returns undefined when owner already equals terminal', () => {
    const state = makeEmptyV016State()
    const reg = makeReg(state, { kind: 'polity', id: po1 })

    state.holdingTerminalPolityCache[hl1] = po1

    const result = regimentOwnerSyncTarget(state, reg)
    expect(result).toBeUndefined()
  })

  it('returns undefined when terminal cache has no entry for the holding', () => {
    const state = makeEmptyV016State()
    const reg = makeReg(state, { kind: 'polity', id: po1 })

    // Do not set cache for hl1

    const result = regimentOwnerSyncTarget(state, reg)
    expect(result).toBeUndefined()
  })

  it('returns undefined when regiment is not active', () => {
    const state = makeEmptyV016State()
    const reg = makeReg(state, { kind: 'polity', id: po1 })

    state.holdingTerminalPolityCache[hl1] = po2

    updateRegimentMut(state, reg.id, { status: 'disbanded' })
    const reg2 = state.regiments[reg.id]!

    const result = regimentOwnerSyncTarget(state, reg2)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// syncRegimentOwnerToHomeTerminalMut
// ---------------------------------------------------------------------------

describe('syncRegimentOwnerToHomeTerminalMut', () => {
  it('reassigns owner to terminal and returns reassigned', () => {
    const state = makeEmptyV016State()
    const reg = makeReg(state, { kind: 'polity', id: po1 })

    state.holdingTerminalPolityCache[hl1] = po2

    const result = syncRegimentOwnerToHomeTerminalMut(state, reg.id)
    expect(result).toBe('reassigned')

    const updated = state.regiments[reg.id]!
    expect(updated.owner).toEqual({ kind: 'polity', id: po2 })

    const newOwnerKey = organizationKey({ kind: 'polity', id: po2 })
    expect(state.regimentIndex.byOwner[newOwnerKey]).toContain(reg.id)

    const oldOwnerKey = organizationKey({ kind: 'polity', id: po1 })
    expect(state.regimentIndex.byOwner[oldOwnerKey]).toBeUndefined()
  })

  it('returns noop when already in sync', () => {
    const state = makeEmptyV016State()
    const reg = makeReg(state, { kind: 'polity', id: po1 })

    state.holdingTerminalPolityCache[hl1] = po1

    const result = syncRegimentOwnerToHomeTerminalMut(state, reg.id)
    expect(result).toBe('noop')

    const updated = state.regiments[reg.id]!
    expect(updated.owner).toEqual({ kind: 'polity', id: po1 })
  })

  it('disbands instead of reassigning when disbandAfterWar is true', () => {
    const state = makeEmptyV016State()
    const reg = makeReg(state, { kind: 'polity', id: po1 })

    updateRegimentMut(state, reg.id, { disbandAfterWar: true })

    state.holdingTerminalPolityCache[hl1] = po2

    const result = syncRegimentOwnerToHomeTerminalMut(state, reg.id)
    expect(result).toBe('disbanded')

    const updated = state.regiments[reg.id]!
    expect(updated.status).toBe('disbanded')
    expect(updated.owner).toEqual({ kind: 'polity', id: po1 })
  })
})
