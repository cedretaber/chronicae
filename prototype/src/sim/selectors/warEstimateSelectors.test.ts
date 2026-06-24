import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { estimateWarSidePower, estimateAttackerWinChance } from './warEstimateSelectors'
import { getOrganizationMilitaryPower } from './organizationSelectors'
import {
  createRegiment,
  mobilizeRegimentMut,
  destroyRegimentMut,
} from '../mutations/regimentMutations'
import type { OrganizationRef } from '../types/office'
import type { PolityId, WarId, HoldingId, ProvinceId } from '../types/ids'

const pA: OrganizationRef = { kind: 'polity', id: 'po-1' as PolityId }
const pB: OrganizationRef = { kind: 'polity', id: 'po-2' as PolityId }

function addRegiment(state: ReturnType<typeof makeEmptyV016State>, owner: OrganizationRef) {
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
// estimateWarSidePower — 実戦闘 (getRegimentPowerForWarSide) と同じ戦力源で算出する。
// ---------------------------------------------------------------------------

describe('estimateWarSidePower', () => {
  it('連隊記録ゼロ → nominal フォールバック (getOrganizationMilitaryPower と一致)', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, 'po-1' as PolityId, { adminPower: 1000 })
    const fallback = getOrganizationMilitaryPower(state, defaultConfig, pA)
    expect(fallback).toBeGreaterThan(0)
    expect(estimateWarSidePower(state, defaultConfig, pA)).toBeCloseTo(fallback)
  })

  it('動員可能な常設連隊の effectivePower 合計 (active かつ未動員)', () => {
    const state = makeEmptyV016State()
    addRegiment(state, pA)
    addRegiment(state, pA)
    // basePower 100 × strength100 × org100 = 100 ずつ → 200
    expect(estimateWarSidePower(state, defaultConfig, pA)).toBeCloseTo(200)
  })

  it('記録はあるが別戦争に動員済み → 0 (nominal にフォールバックしない)', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, 'po-1' as PolityId, { adminPower: 1000 })
    const r = addRegiment(state, pA)
    mobilizeRegimentMut(state, r.id, 'w-other' as WarId, 'attacker', 'po-1' as PolityId, 0)
    expect(getOrganizationMilitaryPower(state, defaultConfig, pA)).toBeGreaterThan(0)
    expect(estimateWarSidePower(state, defaultConfig, pA)).toBe(0)
  })

  it('記録はあるが全滅 → 0 (nominal にフォールバックしない・全滅バグを塞ぐ)', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, 'po-1' as PolityId, { adminPower: 1000 })
    const r = addRegiment(state, pA)
    destroyRegimentMut(state, r.id, 0)
    expect(getOrganizationMilitaryPower(state, defaultConfig, pA)).toBeGreaterThan(0)
    expect(estimateWarSidePower(state, defaultConfig, pA)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// estimateAttackerWinChance — atk/(atk+def)、0 ガード。
// ---------------------------------------------------------------------------

describe('estimateAttackerWinChance', () => {
  it('atk=0 (動員可能ゼロ) → 0', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, 'po-2' as PolityId, { adminPower: 1000 })
    const r = addRegiment(state, pA)
    destroyRegimentMut(state, r.id, 0) // pA 記録あり動員可能 0 → 0
    expect(estimateAttackerWinChance(state, defaultConfig, pA, pB)).toBe(0)
  })

  it('def=0 → 1 (相手が動員できない)', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, 'po-1' as PolityId, { adminPower: 1000 })
    const r = addRegiment(state, pB)
    destroyRegimentMut(state, r.id, 0) // pB 記録あり動員可能 0 → 0
    expect(estimateAttackerWinChance(state, defaultConfig, pA, pB)).toBe(1)
  })

  it('彼我が動員連隊で拮抗 → 0.5', () => {
    const state = makeEmptyV016State()
    addRegiment(state, pA)
    addRegiment(state, pB)
    expect(estimateAttackerWinChance(state, defaultConfig, pA, pB)).toBeCloseTo(0.5)
  })

  it('攻撃側 3 連隊 vs 防御側 1 連隊 → 0.75', () => {
    const state = makeEmptyV016State()
    addRegiment(state, pA)
    addRegiment(state, pA)
    addRegiment(state, pA)
    addRegiment(state, pB)
    expect(estimateAttackerWinChance(state, defaultConfig, pA, pB)).toBeCloseTo(0.75)
  })
})
