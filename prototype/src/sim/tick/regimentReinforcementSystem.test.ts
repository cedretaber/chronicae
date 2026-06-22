import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity, withHolding } from '../testFixtures'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runRegimentReinforcementSystem } from './regimentReinforcementSystem'
import {
  createRegiment,
  mobilizeRegimentMut,
  destroyRegimentMut,
} from '../mutations/regimentMutations'
import { politicalActorKey } from '../selectors/actorSelectors'
import type { WorldState } from '../types/world'
import type { War } from '../types/war'
import type { PolityId, HoldingId, ProvinceId, WarId, PopGroupId } from '../types/ids'
import type { RegimentTroopKind } from '../types/regiment'

// v0.36 補充・再編成 RegimentReinforcementSystem の単体テスト。
//   A. active strength の silent 補充 (homeControl / 平時戦時動員中 / treasury cap)
//   B. destroyed reform (遅延 / pop / treasury gate, REGIMENT_REFORMED emit)

const PO1: PolityId = 'po-1' as PolityId
const PO2: PolityId = 'po-2' as PolityId
const HL1: HoldingId = 'hl-1' as HoldingId
const PR1: ProvinceId = 'pr-1' as ProvinceId

function ctx(state: WorldState) {
  return createTickContext({ state, rng: createRng('reinf'), config: defaultConfig })
}

// terminal==owner で treasury 潤沢、peasants pop で factor=1.0 になる標準セットアップ。
function baseState(
  opts: { peasantSize?: number; treasury?: number; week?: number } = {},
): WorldState {
  let state = makeEmptyV016State()
  state = withPolity(state, PO1, { active: true, treasury: opts.treasury ?? 1000 })
  state = withHolding(state, HL1, PR1)
  state.holdingTerminalPolityCache[HL1] = PO1
  const size = opts.peasantSize ?? 80 // reference peasants=80 → factor 1.0
  const pg: PopGroupId = 'pg-1' as PopGroupId
  state.popGroups[pg] = {
    id: pg,
    holdingId: HL1,
    class: 'lower',
    popType: 'peasants',
    employed: true,
    size,
    wealth: 0,
    money: 0,
    needSatisfaction: 50,
    unrest: 0,
    attitudes: {},
  }
  state.popIndex.byHolding[HL1] = [pg]
  state.absoluteWeek = opts.week ?? 0
  return state
}

function addReg(
  state: WorldState,
  opts: { strength: number; troopKind?: RegimentTroopKind; owner?: PolityId } = { strength: 50 },
) {
  return createRegiment(state, {
    owner: { kind: 'polity', id: opts.owner ?? PO1 },
    sourceKind: 'levy',
    troopKind: opts.troopKind ?? 'infantry',
    homeHoldingId: HL1,
    homeProvinceId: PR1,
    strength: opts.strength,
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

function makeWar(id: WarId, status: War['status']): War {
  return {
    id,
    status,
    attacker: {
      key: 'attacker',
      participants: [{ actor: { kind: 'polity', id: PO1 }, joinedWeek: 0, primary: true }],
      commanderPersonIds: [],
      avoidanceCount: 0,
    },
    defender: {
      key: 'defender',
      participants: [{ actor: { kind: 'polity', id: PO2 }, joinedWeek: 0, primary: true }],
      commanderPersonIds: [],
      avoidanceCount: 0,
    },
    warGoals: [],
    warScore: 0,
    targetWarScore: 50,
    startedWeek: 0,
  }
}

describe('RegimentReinforcementSystem — active strength 補充 (平時)', () => {
  it('terminal==owner・治金潤沢なら strength を base×popFactor だけ補充し treasury を支払う (silent)', () => {
    const state = baseState()
    const r = addReg(state, { strength: 50 })
    const before = state.polities[PO1]!.treasury

    const result = runRegimentReinforcementSystem(ctx(state))
    const rr = result.state.regiments[r.id]!
    // base 4.0 × popFactor 1.0 × homeControl 1 × peace 1 × infantry 1 = 4.0
    expect(rr.strength).toBeCloseTo(54, 5)
    expect(rr.lastReinforcedWeek).toBe(0)
    // cost = 4.0 × costPerStrength(0.2) = 0.8
    expect(result.state.polities[PO1]!.treasury).toBeCloseTo(before - 0.8, 5)
    // strength 補充ではイベントは出ない (silent)
    expect(result.events.length).toBe(0)
  })

  it('strength が maxStrength なら no-op (clone されず同一 state)', () => {
    const state = baseState()
    addReg(state, { strength: 100 })
    const input = ctx(state)
    const next = runRegimentReinforcementSystem(input)
    expect(next.state).toBe(input.state)
  })
})

describe('RegimentReinforcementSystem — homeControlFactor', () => {
  it('home terminal Polity が owner と異なれば補充しない', () => {
    const state = baseState()
    state.holdingTerminalPolityCache[HL1] = PO2 // owner(PO1) と不一致
    const r = addReg(state, { strength: 50 })
    const next = runRegimentReinforcementSystem(ctx(state)).state
    expect(next.regiments[r.id]!.strength).toBe(50) // 不変
  })
})

describe('RegimentReinforcementSystem — 平時/戦時/動員中の係数差', () => {
  it('owner が active war 参加中 (未動員) なら平時より遅い (warMultiplier)', () => {
    const state = baseState()
    state.wars['w-1' as WarId] = makeWar('w-1' as WarId, 'active')
    state.warIndex.byParticipant[politicalActorKey({ kind: 'polity', id: PO1 })] = ['w-1' as WarId]
    const r = addReg(state, { strength: 50 })
    const next = runRegimentReinforcementSystem(ctx(state)).state
    // 4.0 × 1.0 × warMultiplier(0.4) = 1.6
    expect(next.regiments[r.id]!.strength).toBeCloseTo(51.6, 5)
  })

  it('動員中の Regiment はさらに遅い (war×mobilized)', () => {
    const state = baseState()
    state.wars['w-1' as WarId] = makeWar('w-1' as WarId, 'active')
    state.warIndex.byParticipant[politicalActorKey({ kind: 'polity', id: PO1 })] = ['w-1' as WarId]
    const r = addReg(state, { strength: 50 })
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', PO1, 0)
    const next = runRegimentReinforcementSystem(ctx(state)).state
    // 4.0 × 1.0 × warMultiplier(0.4) × mobilizedMultiplier(0.25) = 0.4
    expect(next.regiments[r.id]!.strength).toBeCloseTo(50.4, 5)
  })
})

describe('RegimentReinforcementSystem — treasury cap', () => {
  it('treasury 不足なら affordable 分だけ補充して treasury を 0 にする', () => {
    const state = baseState({ treasury: 0.1 })
    const r = addReg(state, { strength: 50 })
    const next = runRegimentReinforcementSystem(ctx(state)).state
    // affordable = 0.1 / 0.2 = 0.5 (desired 4.0 より小さい) → gain 0.5
    expect(next.regiments[r.id]!.strength).toBeCloseTo(50.5, 5)
    expect(next.polities[PO1]!.treasury).toBeCloseTo(0, 5)
  })
})

describe('RegimentReinforcementSystem — destroyed reform', () => {
  it('reform 遅延を満たし pop/treasury が足りれば active に再編成し REGIMENT_REFORMED を出す', () => {
    const state = baseState({ week: 30 }) // delay 24 < 30
    const r = addReg(state, { strength: 50 })
    destroyRegimentMut(state, r.id, 0) // destroyedWeek=0 → 30-0=30 >= 24
    expect(state.regiments[r.id]!.status).toBe('destroyed')
    const treasuryBefore = state.polities[PO1]!.treasury

    const result = runRegimentReinforcementSystem(ctx(state))
    const rr = result.state.regiments[r.id]!
    expect(rr.status).toBe('active')
    expect(rr.strength).toBe(defaultConfig.destroyedRegimentReformInitialStrength)
    expect(rr.organization).toBe(defaultConfig.destroyedRegimentReformInitialOrganization)
    expect(rr.morale).toBe(defaultConfig.destroyedRegimentReformInitialMorale)
    expect(rr.destroyedWeek).toBeUndefined()
    expect(rr.lastReinforcedWeek).toBe(30)
    expect(result.state.polities[PO1]!.treasury).toBeCloseTo(
      treasuryBefore - defaultConfig.destroyedRegimentReformCost,
      5,
    )
    const reformed = result.events.find((e) => e.type === 'REGIMENT_REFORMED')
    expect(reformed).toBeDefined()
    expect(reformed!.messageKey).toBe('regiment.reformed')
  })

  it('reform 遅延前は再編成しない (destroyed のまま)', () => {
    const state = baseState({ week: 30 })
    const r = addReg(state, { strength: 50 })
    destroyRegimentMut(state, r.id, 20) // 30-20=10 < delay 24
    const next = runRegimentReinforcementSystem(ctx(state)).state
    expect(next.regiments[r.id]!.status).toBe('destroyed')
  })

  it('pop が reformMinPopFactor 未満なら再編成しない', () => {
    // peasantSize 0 → popFactor floors at minPopFactor 0.1 < reformMinPopFactor 0.25
    const state = baseState({ week: 30, peasantSize: 0 })
    const r = addReg(state, { strength: 50 })
    destroyRegimentMut(state, r.id, 0)
    const next = runRegimentReinforcementSystem(ctx(state)).state
    expect(next.regiments[r.id]!.status).toBe('destroyed')
  })

  it('treasury が reformCost 未満なら再編成しない', () => {
    const state = baseState({ week: 30, treasury: 1 }) // reformCost 8 > 1
    const r = addReg(state, { strength: 50 })
    destroyRegimentMut(state, r.id, 0)
    const next = runRegimentReinforcementSystem(ctx(state)).state
    expect(next.regiments[r.id]!.status).toBe('destroyed')
  })
})

describe('RegimentReinforcementSystem — 決定的順序', () => {
  it('treasury 共有時、RegimentId 昇順で先の Regiment が優先的に補充される', () => {
    // treasury = 0.5 → 0.5/0.2 = 2.5 strength 分しか払えない。rg-0 が先に desired 2.5 まで取り、rg-1 は 0。
    const state = baseState({ treasury: 0.5 })
    const r0 = addReg(state, { strength: 98 }) // rg-0, deficit 2 → desired min(4, 2)=2, cost 0.4
    const r1 = addReg(state, { strength: 50 }) // rg-1, deficit 50 → desired 4
    const next = runRegimentReinforcementSystem(ctx(state)).state
    // rg-0: gain 2 (deficit cap), cost 0.4 → treasury 0.5-0.4=0.1 残
    expect(next.regiments[r0.id]!.strength).toBeCloseTo(100, 5)
    // rg-1: affordable = 0.1/0.2 = 0.5 → gain 0.5
    expect(next.regiments[r1.id]!.strength).toBeCloseTo(50.5, 5)
  })
})
