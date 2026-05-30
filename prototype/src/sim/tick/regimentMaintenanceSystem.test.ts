import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity, withHolding } from '../testFixtures'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runRegimentMaintenanceSystem } from './regimentMaintenanceSystem'
import { createRegiment, mobilizeRegimentMut } from '../mutations/regimentMutations'
import { politicalActorKey } from '../selectors/actorSelectors'
import type { WorldState } from '../types/world'
import type { War } from '../types/war'
import type { PolityId, HoldingId, ProvinceId, WarId } from '../types/ids'

// v0.36 §14 RegimentMaintenanceSystem の単体テスト。
//   demobilize / owner inactive disband / homeHolding missing disband / §14.6 owner 付け替え。
//   §14.6 の「付け替え → owner-inactive チェック」順序 (advisor 強制ケース) を含む。

const PO1: PolityId = 'po-1' as PolityId
const PO2: PolityId = 'po-2' as PolityId
const HL1: HoldingId = 'hl-1' as HoldingId
const PR1: ProvinceId = 'pr-1' as ProvinceId

function ctx(state: WorldState) {
  return createTickContext({ state, rng: createRng('maint'), config: defaultConfig })
}

function addRegiment(state: WorldState, opts: { owner: PolityId; homeHoldingId?: HoldingId }) {
  return createRegiment(state, {
    owner: { kind: 'polity', id: opts.owner },
    sourceKind: 'levy',
    troopKind: 'infantry',
    ...(opts.homeHoldingId !== undefined ? { homeHoldingId: opts.homeHoldingId } : {}),
    homeProvinceId: PR1,
    strength: 100,
    organization: 100,
    morale: 80,
    maxStrength: 100,
    basePower: 100,
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

describe('RegimentMaintenanceSystem §14.3 demobilize (stale war)', () => {
  it('terminal war に mobilize されたままの Regiment を demobilize する', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, PO1, { active: true })
    state = withHolding(state, HL1, PR1)
    state.holdingTerminalPolityCache[HL1] = PO1
    state.wars['w-1' as WarId] = makeWar('w-1' as WarId, 'attacker_won') // terminal
    const r = addRegiment(state, { owner: PO1, homeHoldingId: HL1 })
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', PO1, 0)

    const next = runRegimentMaintenanceSystem(ctx(state)).state
    const rr = next.regiments[r.id]!
    expect(rr.status).toBe('active') // demobilize は status を変えない
    expect(rr.currentWarId).toBeUndefined()
    expect(rr.currentSide).toBeUndefined()
    expect(next.regimentIndex.byWar['w-1' as WarId]).toBeUndefined()
  })

  it('active war の Regiment は demobilize しない', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, PO1, { active: true })
    state = withHolding(state, HL1, PR1)
    state.holdingTerminalPolityCache[HL1] = PO1
    state.wars['w-1' as WarId] = makeWar('w-1' as WarId, 'active')
    const r = addRegiment(state, { owner: PO1, homeHoldingId: HL1 })
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', PO1, 0)

    const next = runRegimentMaintenanceSystem(ctx(state)).state
    expect(next.regiments[r.id]!.currentWarId).toBe('w-1')
    expect(next.regimentIndex.byWar['w-1' as WarId]).toContain(r.id)
  })
})

describe('RegimentMaintenanceSystem §14.4 owner inactive disband', () => {
  it('owner polity が inactive なら disband する', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, PO1, { active: false }) // inactive
    const r = addRegiment(state, { owner: PO1 }) // homeHolding なし → §14.5/14.6 skip
    const next = runRegimentMaintenanceSystem(ctx(state)).state
    expect(next.regiments[r.id]!.status).toBe('disbanded')
  })
})

describe('RegimentMaintenanceSystem §14.5 homeHolding missing disband', () => {
  it('homeHolding が holdings に存在しなければ disband する', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, PO1, { active: true })
    // hl-1 は holdings に追加しない（消失を表す）
    const r = addRegiment(state, { owner: PO1, homeHoldingId: HL1 })
    const next = runRegimentMaintenanceSystem(ctx(state)).state
    expect(next.regiments[r.id]!.status).toBe('disbanded')
  })
})

describe('RegimentMaintenanceSystem §14.6 owner 付け替え (advisor 強制ケース)', () => {
  it('home terminal Polity が変わったら disband でなく owner を付け替え、war 参照は維持する', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, PO1, { active: true })
    state = withPolity(state, PO2, { active: true })
    state = withHolding(state, HL1, PR1)
    state.holdingTerminalPolityCache[HL1] = PO2 // owner(po-1) と異なる
    state.wars['w-1' as WarId] = makeWar('w-1' as WarId, 'active')
    const r = addRegiment(state, { owner: PO1, homeHoldingId: HL1 })
    mobilizeRegimentMut(state, r.id, 'w-1' as WarId, 'attacker', PO1, 0)

    const next = runRegimentMaintenanceSystem(ctx(state)).state
    const rr = next.regiments[r.id]!
    expect(rr.status).toBe('active') // disband されない
    expect(rr.owner).toEqual({ kind: 'polity', id: PO2 }) // 付け替え
    // byOwner index も移動
    expect(
      next.regimentIndex.byOwner[politicalActorKey({ kind: 'polity', id: PO1 })],
    ).toBeUndefined()
    expect(next.regimentIndex.byOwner[politicalActorKey({ kind: 'polity', id: PO2 })]).toContain(
      r.id,
    )
    // war 動員状態は不変 (§14.6: currentWarId 等は触らない)
    expect(rr.currentWarId).toBe('w-1')
    expect(rr.currentSide).toBe('attacker')
    expect(next.regimentIndex.byWar['w-1' as WarId]).toContain(r.id)
  })

  it('付け替え後の新 owner が inactive なら disband に倒す (付け替え→inactive チェックの順)', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, PO1, { active: true })
    state = withPolity(state, PO2, { active: false }) // 新 owner が inactive
    state = withHolding(state, HL1, PR1)
    state.holdingTerminalPolityCache[HL1] = PO2
    const r = addRegiment(state, { owner: PO1, homeHoldingId: HL1 })

    const next = runRegimentMaintenanceSystem(ctx(state)).state
    const rr = next.regiments[r.id]!
    expect(rr.owner).toEqual({ kind: 'polity', id: PO2 }) // 先に付け替え
    expect(rr.status).toBe('disbanded') // 直後に inactive 判定で disband
  })
})

describe('RegimentMaintenanceSystem no-op', () => {
  it('整理対象が無ければ同一 ctx を返す (lazy clone)', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, PO1, { active: true })
    state = withHolding(state, HL1, PR1)
    state.holdingTerminalPolityCache[HL1] = PO1
    addRegiment(state, { owner: PO1, homeHoldingId: HL1 })

    const input = ctx(state)
    const next = runRegimentMaintenanceSystem(input)
    expect(next.state).toBe(input.state) // clone されず参照同一
  })
})
