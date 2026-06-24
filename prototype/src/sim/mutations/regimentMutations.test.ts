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
  reformRegimentMut,
  mobilizeRegimentsForWar,
} from './regimentMutations'
import { organizationKey } from '../selectors/organizationSelectors'
import type { WorldState } from '../types/world'
import type { OrganizationRef } from '../types/office'
import type { War } from '../types/war'
import type { PolityId, HoldingId, ProvinceId, WarId } from '../types/ids'

const pA: OrganizationRef = { kind: 'polity', id: 'po-1' as PolityId }
const pB: OrganizationRef = { kind: 'polity', id: 'po-2' as PolityId }

function makeReg(state: WorldState, owner: OrganizationRef = pA) {
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
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
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

    expect(state.regimentIndex.byOwner[organizationKey(pA)]).toContain(r.id)
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
    expect(state.regimentIndex.byOwner[organizationKey(pA)]).toBeUndefined()
    expect(state.regimentIndex.byOwner[organizationKey(pB)]).toContain(r.id)
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
    expect(state.regimentIndex.byOwner[organizationKey(pA)]!.length).toBe(1)
    expect(state.regimentIndex.byOwner[organizationKey(pA)]).toContain(r.id)

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

    destroyRegimentMut(state, r.id, 12)

    expect(state.regiments[r.id]!.status).toBe('destroyed')
    expect(state.regiments[r.id]!.destroyedWeek).toBe(12)
    expect(state.regiments[r.id]!.currentWarId).toBeUndefined()
    expect(state.regimentIndex.byWar['w-1' as WarId]).toBeUndefined()

    // byOwner STILL contains r.id
    expect(state.regimentIndex.byOwner[organizationKey(pA)]!.length).toBe(1)
    expect(state.regimentIndex.byOwner[organizationKey(pA)]).toContain(r.id)

    // byHomeHolding STILL contains r.id
    expect(state.regimentIndex.byHomeHolding['hl-1' as HoldingId]).toContain(r.id)

    // byHomeProvince STILL contains r.id
    expect(state.regimentIndex.byHomeProvince['pr-1' as ProvinceId]).toContain(r.id)
  })
})

// ---------------------------------------------------------------------------
// reformRegimentMut (v0.36 補充・再編成)
// ---------------------------------------------------------------------------

describe('reformRegimentMut — destroyed を active に戻す', () => {
  it('reforms a destroyed regiment: status/values reset, destroyedWeek cleared, index unchanged', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)
    destroyRegimentMut(state, r.id, 10)
    expect(state.regiments[r.id]!.status).toBe('destroyed')
    expect(state.regiments[r.id]!.destroyedWeek).toBe(10)

    reformRegimentMut(state, r.id, { strength: 20, organization: 20, morale: 40 }, 34)

    const reformed = state.regiments[r.id]!
    expect(reformed.status).toBe('active')
    expect(reformed.strength).toBe(20)
    expect(reformed.organization).toBe(20)
    expect(reformed.morale).toBe(40)
    expect(reformed.destroyedWeek).toBeUndefined()
    expect(reformed.lastReinforcedWeek).toBe(34)

    // index は destroy 後も byOwner/byHomeHolding に残っていて reform でも不変。
    expect(state.regimentIndex.byOwner[organizationKey(pA)]).toContain(r.id)
    expect(state.regimentIndex.byHomeHolding['hl-1' as HoldingId]).toContain(r.id)
    // byWar には居ない (destroy で外れたまま)。
    expect(Object.keys(state.regimentIndex.byWar).length).toBe(0)
  })

  it('does NOT reform a disbanded regiment (no-op)', () => {
    const state = makeEmptyV016State()
    const r = makeReg(state)
    disbandRegimentMut(state, r.id)
    expect(state.regiments[r.id]!.status).toBe('disbanded')

    reformRegimentMut(state, r.id, { strength: 20, organization: 20, morale: 40 }, 34)

    // disbanded は再編成対象外 → status は disbanded のまま。
    expect(state.regiments[r.id]!.status).toBe('disbanded')
    expect(state.regiments[r.id]!.strength).toBe(100)
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

// ---------------------------------------------------------------------------
// mobilizeRegimentsForWar (§9.1-9.3) — WarManeuver per-war prologue から呼ぶ composite
// ---------------------------------------------------------------------------

function makeWar(id: WarId, attacker: OrganizationRef, defender: OrganizationRef): War {
  return {
    id,
    status: 'active',
    attacker: {
      key: 'attacker',
      participants: [{ actor: attacker, joinedWeek: 0, primary: true }],
      commanderPersonIds: [],
      avoidanceCount: 0,
    },
    defender: {
      key: 'defender',
      participants: [{ actor: defender, joinedWeek: 0, primary: true }],
      commanderPersonIds: [],
      avoidanceCount: 0,
    },
    warGoals: [],
    warScore: 0,
    targetWarScore: 50,
    startedWeek: 0,
  }
}

describe('mobilizeRegimentsForWar', () => {
  it('owner の active かつ未動員の Regiment を当該 side に mobilize する', () => {
    const state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)
    state.wars[war.id] = war
    const r1 = makeReg(state, pA)
    const r2 = makeReg(state, pA)

    mobilizeRegimentsForWar(state, war.id, 'attacker', 5)

    expect(state.regiments[r1.id]!.currentWarId).toBe('w-1')
    expect(state.regiments[r1.id]!.currentSide).toBe('attacker')
    expect(state.regiments[r1.id]!.lastMobilizedWeek).toBe(5)
    expect(state.regiments[r2.id]!.currentWarId).toBe('w-1')
    expect((state.regimentIndex.byWar['w-1' as WarId] ?? []).length).toBe(2)
  })

  it('別 side の owner Regiment は mobilize しない', () => {
    const state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)
    state.wars[war.id] = war
    const rA = makeReg(state, pA)
    const rB = makeReg(state, pB)

    mobilizeRegimentsForWar(state, war.id, 'attacker', 0)

    expect(state.regiments[rA.id]!.currentWarId).toBe('w-1')
    expect(state.regiments[rB.id]!.currentWarId).toBeUndefined() // defender 側 owner は対象外
  })

  it('別 War に出払い済 (currentWarId あり) の Regiment は mobilize しない', () => {
    const state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)
    state.wars[war.id] = war
    const r = makeReg(state, pA)
    mobilizeRegimentMut(state, r.id, 'w-other' as WarId, 'attacker', 'po-1' as PolityId, 0)

    mobilizeRegimentsForWar(state, war.id, 'attacker', 0)

    expect(state.regiments[r.id]!.currentWarId).toBe('w-other') // 据え置き
    expect(state.regimentIndex.byWar['w-1' as WarId]).toBeUndefined()
  })

  it('非 active (disbanded) Regiment は mobilize しない', () => {
    const state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)
    state.wars[war.id] = war
    const r = makeReg(state, pA)
    disbandRegimentMut(state, r.id)

    mobilizeRegimentsForWar(state, war.id, 'attacker', 0)

    expect(state.regiments[r.id]!.currentWarId).toBeUndefined()
    expect(state.regimentIndex.byWar['w-1' as WarId]).toBeUndefined()
  })

  it('idempotent: 2 回呼んでも byWar は重複しない', () => {
    const state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)
    state.wars[war.id] = war
    makeReg(state, pA)

    mobilizeRegimentsForWar(state, war.id, 'attacker', 0)
    mobilizeRegimentsForWar(state, war.id, 'attacker', 0)

    expect((state.regimentIndex.byWar['w-1' as WarId] ?? []).length).toBe(1)
  })
})
