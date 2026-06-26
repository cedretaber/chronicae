import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import {
  getRegimentEffectivePower,
  getRegimentsForActor,
  getRegimentsForWarSide,
  getRegimentPowerForWarSide,
} from './regimentSelectors'
import {
  createRegimentWithBarracksMut,
  mobilizeRegimentMut,
  destroyRegimentMut,
} from '../mutations/regimentMutations'
import { getOrganizationMilitaryPower } from './organizationSelectors'
import type { Regiment } from '../types/regiment'
import type { War } from '../types/war'
import type { OrganizationRef } from '../types/office'
import type { PolityId, WarId, HoldingId, RegimentBarracksId } from '../types/ids'

const pA: OrganizationRef = { kind: 'polity', id: 'po-1' as PolityId }
const pB: OrganizationRef = { kind: 'polity', id: 'po-2' as PolityId }

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

function reg(overrides: Partial<Regiment>): Regiment {
  return {
    id: 'rg-x' as Regiment['id'],
    owner: pA,
    status: 'active',
    sourceKind: 'levy',
    troopKind: 'infantry',
    barracksId: 'bk-0' as RegimentBarracksId,
    strength: 100,
    organization: 100,
    morale: 80,
    maxStrength: 100,
    basePower: 200,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
    ...overrides,
  }
}

function addReg(
  state: ReturnType<typeof makeEmptyV016State>,
  owner: OrganizationRef,
  holdingId: HoldingId = 'hl-1' as HoldingId,
) {
  const { regiment } = createRegimentWithBarracksMut(state, {
    owner,
    sourceKind: 'levy',
    troopKind: 'infantry',
    holdingId,
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
// getRegimentEffectivePower
// ---------------------------------------------------------------------------

describe('getRegimentEffectivePower', () => {
  it('active strength=100 org=100 basePower=200 => 200', () => {
    expect(
      getRegimentEffectivePower(reg({ strength: 100, organization: 100, basePower: 200 })),
    ).toBeCloseTo(200)
  })

  it('active strength=100 org=0 basePower=200 => 100', () => {
    expect(
      getRegimentEffectivePower(reg({ strength: 100, organization: 0, basePower: 200 })),
    ).toBeCloseTo(100)
  })

  it('active strength=50 org=100 basePower=200 => 100', () => {
    expect(
      getRegimentEffectivePower(reg({ strength: 50, organization: 100, basePower: 200 })),
    ).toBeCloseTo(100)
  })

  it('active strength=50 org=0 basePower=200 => 50', () => {
    expect(
      getRegimentEffectivePower(reg({ strength: 50, organization: 0, basePower: 200 })),
    ).toBeCloseTo(50)
  })

  it("status 'disbanded' => 0", () => {
    expect(getRegimentEffectivePower(reg({ status: 'disbanded' }))).toBe(0)
  })

  it("status 'destroyed' => 0", () => {
    expect(getRegimentEffectivePower(reg({ status: 'destroyed' }))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getRegimentsForActor / getRegimentsForWarSide
// ---------------------------------------------------------------------------

describe('getRegimentsForActor / getRegimentsForWarSide', () => {
  it('getRegimentsForActor returns correct regiments per actor', () => {
    const state = makeEmptyV016State()
    const r1 = addReg(state, pA, 'hl-1' as HoldingId)
    const r2 = addReg(state, pA, 'hl-2' as HoldingId)

    expect(r1.id).toBeDefined()
    expect(r2.id).toBeDefined()

    expect(getRegimentsForActor(state, pA).length).toBe(2)
    expect(getRegimentsForActor(state, pB).length).toBe(0)
  })

  it('getRegimentsForWarSide returns correct regiments for war side', () => {
    const state = makeEmptyV016State()
    const r1 = addReg(state, pA)

    expect(r1.id).toBeDefined()
    mobilizeRegimentMut(state, r1.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 0)

    expect(getRegimentsForWarSide(state, 'w-1' as WarId, 'attacker').length).toBe(1)
    expect(getRegimentsForWarSide(state, 'w-1' as WarId, 'defender').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getRegimentPowerForWarSide — 4 cases
// ---------------------------------------------------------------------------

describe('getRegimentPowerForWarSide', () => {
  it('(b) mobilized sum: two regiments => sum of effective powers', () => {
    const state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)

    const r1 = addReg(state, pA, 'hl-1' as HoldingId)
    const r2 = addReg(state, pA, 'hl-2' as HoldingId)

    expect(r1.id).toBeDefined()
    expect(r2.id).toBeDefined()
    mobilizeRegimentMut(state, r1.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 0)
    mobilizeRegimentMut(state, r2.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 0)

    expect(getRegimentPowerForWarSide(state, defaultConfig, war, 'attacker')).toBeCloseTo(200)
  })

  it('(a) no record => legacy fallback: polity with no regiments uses getOrganizationMilitaryPower', () => {
    let state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)

    // Add polity with adminPower so calcPolityMilitaryPower > 0
    state = withPolity(state, 'po-1' as PolityId, { adminPower: 1000 })

    // pA owns NO regiments
    const fallback = getOrganizationMilitaryPower(state, defaultConfig, pA)
    expect(fallback).toBeGreaterThan(0)

    expect(getRegimentPowerForWarSide(state, defaultConfig, war, 'attacker')).toBeCloseTo(fallback)
  })

  it('(c) committed to another war => 0', () => {
    const state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)

    const r1 = addReg(state, pA)

    expect(r1.id).toBeDefined()
    // Mobilize to a DIFFERENT war
    mobilizeRegimentMut(state, r1.id, 'w-other' as WarId, 'attacker', 'po-1' as PolityId, 0)

    expect(getRegimentPowerForWarSide(state, defaultConfig, war, 'attacker')).toBe(0)
  })

  // v0.43 §12.4: multi-participant fallback
  it('(e) v0.43 fallback: mobilized 0 のとき participant ごとに合算 (record 無は nominal / 有は 0)', () => {
    let state = makeEmptyV016State()
    const pSup: OrganizationRef = { kind: 'polity', id: 'po-3' as PolityId }
    const war = makeWar('w-1' as WarId, pA, pB)
    war.attacker.participants = [
      ...war.attacker.participants,
      { actor: pSup, joinedWeek: 0, primary: false },
    ]
    state = withPolity(state, 'po-1' as PolityId, { adminPower: 1000 })
    state = withPolity(state, 'po-3' as PolityId, { adminPower: 1000 })

    // 両方 record 無 → nominal の合算
    const nominalPrimary = getOrganizationMilitaryPower(state, defaultConfig, pA)
    const nominalSup = getOrganizationMilitaryPower(state, defaultConfig, pSup)
    expect(getRegimentPowerForWarSide(state, defaultConfig, war, 'attacker')).toBeCloseTo(
      nominalPrimary + nominalSup,
    )

    // primary に record (未動員ではなく destroyed) → primary は 0、supporter の nominal のみ
    const r1 = addReg(state, pA)
    destroyRegimentMut(state, r1.id, 0)
    expect(getRegimentPowerForWarSide(state, defaultConfig, war, 'attacker')).toBeCloseTo(
      nominalSup,
    )
  })

  it('(f) v0.43: mobilized 経路は participant 数に依存しない (supporter 追加で不変)', () => {
    const state = makeEmptyV016State()
    const pSup: OrganizationRef = { kind: 'polity', id: 'po-3' as PolityId }
    const war = makeWar('w-1' as WarId, pA, pB)
    war.attacker.participants = [
      ...war.attacker.participants,
      { actor: pSup, joinedWeek: 0, primary: false },
    ]
    const r1 = addReg(state, pA)
    mobilizeRegimentMut(state, r1.id, 'w-1' as WarId, 'attacker', 'po-1' as PolityId, 0)
    expect(getRegimentPowerForWarSide(state, defaultConfig, war, 'attacker')).toBeCloseTo(100)
  })

  it('(d) all destroyed => 0, NOT fallback (CRITICAL)', () => {
    let state = makeEmptyV016State()
    const war = makeWar('w-1' as WarId, pA, pB)

    // Add polity with adminPower so getOrganizationMilitaryPower > 0
    state = withPolity(state, 'po-1' as PolityId, { adminPower: 1000 })

    const r1 = addReg(state, pA)

    expect(r1.id).toBeDefined()
    destroyRegimentMut(state, r1.id, 0)

    // Sanity: fallback WOULD be positive
    expect(getOrganizationMilitaryPower(state, defaultConfig, pA)).toBeGreaterThan(0)

    // owns a destroyed regiment record => byOwner non-empty => 0 power, does NOT fall back even though getOrganizationMilitaryPower > 0 (§10.4 case d)
    expect(getRegimentPowerForWarSide(state, defaultConfig, war, 'attacker')).toBe(0)
  })
})
