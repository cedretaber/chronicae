import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import {
  createRegiment,
  updateRegimentMut,
  mobilizeRegimentMut,
  demobilizeRegimentMut,
  reassignRegimentOwnerMut,
  disbandRegimentMut,
  destroyRegimentMut,
} from './regimentMutations'
import { politicalActorKey } from '../selectors/actorSelectors'
import type { WorldState } from '../types/world'
import type { PoliticalActorRef } from '../types/actor'
import type { PolityId, HoldingId, ProvinceId, WarId } from '../types/ids'

const pA: PoliticalActorRef = { kind: 'polity', id: 'po-1' as PolityId }
const pB: PoliticalActorRef = { kind: 'polity', id: 'po-2' as PolityId }

function makeReg(state: WorldState, owner: PoliticalActorRef = pA) {
  return createRegiment(state, {
    owner,
    sourceKind: 'levy',
    troopKind: 'infantry',
    homeHoldingId: 'hl-1' as HoldingId,
    homeProvinceId: 'pr-1' as ProvinceId,
    strength: 100,
    organization: 100,
    morale: 80,
    maxStrength: 100,
    basePower: 100,
    createdWeek: 0,
  })
}

// ---------------------------------------------------------------------------
// createRegiment
// ---------------------------------------------------------------------------

describe('createRegiment', () => {
  it('creates regiment with correct id, increments counter, sets defaults', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBe('rg-0')
    expect(state.nextRegimentId).toBe(1)
    expect(r.status).toBe('active')
  })

  it('adds regiment to byOwner index', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(state.regimentIndex.byOwner[politicalActorKey(pA)]).toContain(r.id)
  })

  it('adds regiment to byHomeHolding index', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(state.regimentIndex.byHomeHolding['hl-1' as HoldingId]).toContain(r.id)
  })

  it('adds regiment to byHomeProvince index', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(state.regimentIndex.byHomeProvince['pr-1' as ProvinceId]).toContain(r.id)
  })

  it('regiment has no currentWarId', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.currentWarId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// mobilize / demobilize
// ---------------------------------------------------------------------------

describe('mobilize / demobilize', () => {
  it('mobilize sets war refs and adds to byWar index', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBeDefined()
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 5)

    expect(state.regiments[r.id]!.currentWarId).toBe('w-1')
    expect(state.regiments[r.id]!.currentSide).toBe('attacker')
    expect(state.regiments[r.id]!.lastMobilizedWeek).toBe(5)
    expect(state.regimentIndex.byWar['w-1' as WarId]).toContain(r.id)
    expect(state.regimentIndex.byWar['w-1' as WarId]!.length).toBe(1)
  })

  it('mobilize is idempotent: same args => byWar still length 1', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBeDefined()
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 5)
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 5)

    expect(state.regimentIndex.byWar['w-1' as WarId]!.length).toBe(1)
  })

  it('demobilize clears war refs and purges byWar entry', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBeDefined()
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 5)
    demobilizeRegimentMut(state, r.id)

    expect(state.regiments[r.id]!.currentWarId).toBeUndefined()
    expect(state.regiments[r.id]!.currentSide).toBeUndefined()
    expect(state.regimentIndex.byWar['w-1' as WarId]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// reassignRegimentOwnerMut
// ---------------------------------------------------------------------------

describe('reassignRegimentOwnerMut', () => {
  it('updates owner and moves between byOwner indexes', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBeDefined()
    reassignRegimentOwnerMut(state, r.id, pB)

    expect(state.regiments[r.id]!.owner).toEqual(pB)
    expect(state.regimentIndex.byOwner[politicalActorKey(pA)]).toBeUndefined()
    expect(state.regimentIndex.byOwner[politicalActorKey(pB)]).toContain(r.id)
  })
})

// ---------------------------------------------------------------------------
// disbandRegimentMut — keeps owner/home indexes (CRITICAL)
// ---------------------------------------------------------------------------

describe('disbandRegimentMut — keeps owner/home indexes (CRITICAL)', () => {
  it('disbands but keeps byOwner/byHomeHolding/byHomeProvince', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBeDefined()
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 0)

    disbandRegimentMut(state, r.id)

    expect(state.regiments[r.id]!.status).toBe('disbanded')
    expect(state.regiments[r.id]!.currentWarId).toBeUndefined()
    expect(state.regimentIndex.byWar['w-1' as WarId]).toBeUndefined()

    // byOwner STILL contains r.id
    expect(state.regimentIndex.byOwner[politicalActorKey(pA)]!.length).toBe(1)
    expect(state.regimentIndex.byOwner[politicalActorKey(pA)]).toContain(r.id)

    // byHomeHolding STILL contains r.id
    expect(state.regimentIndex.byHomeHolding['hl-1' as HoldingId]).toContain(r.id)

    // byHomeProvince STILL contains r.id
    expect(state.regimentIndex.byHomeProvince['pr-1' as ProvinceId]).toContain(r.id)
  })
})

// ---------------------------------------------------------------------------
// destroyRegimentMut — keeps owner/home indexes (CRITICAL)
// ---------------------------------------------------------------------------

describe('destroyRegimentMut — keeps owner/home indexes (CRITICAL)', () => {
  it('destroys but keeps byOwner/byHomeHolding/byHomeProvince', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBeDefined()
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 0)

    destroyRegimentMut(state, r.id)

    expect(state.regiments[r.id]!.status).toBe('destroyed')
    expect(state.regiments[r.id]!.currentWarId).toBeUndefined()
    expect(state.regimentIndex.byWar['w-1' as WarId]).toBeUndefined()

    // byOwner STILL contains r.id
    expect(state.regimentIndex.byOwner[politicalActorKey(pA)]!.length).toBe(1)
    expect(state.regimentIndex.byOwner[politicalActorKey(pA)]).toContain(r.id)

    // byHomeHolding STILL contains r.id
    expect(state.regimentIndex.byHomeHolding['hl-1' as HoldingId]).toContain(r.id)

    // byHomeProvince STILL contains r.id
    expect(state.regimentIndex.byHomeProvince['pr-1' as ProvinceId]).toContain(r.id)
  })
})

// ---------------------------------------------------------------------------
// updateRegimentMut
// ---------------------------------------------------------------------------

describe('updateRegimentMut', () => {
  it('patches organization and strength, leaves owner unchanged', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)

    expect(r.id).toBeDefined()
    updateRegimentMut(state, r.id, { organization: 40, strength: 90 })

    expect(state.regiments[r.id]!.organization).toBe(40)
    expect(state.regiments[r.id]!.strength).toBe(90)
    expect(state.regiments[r.id]!.owner).toEqual(pA)
  })
})
