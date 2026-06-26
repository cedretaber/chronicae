// v0.42 §7 RightConsistencySystem / §6.4 cascade のユニットテスト (spec §20.1)。
// - dead person holder / extinct house holder の right が削除される
// - regiment owner Polity 変化 / holding terminal polity 変化で失効する
// - destroyed regiment の right は失効しない (§11.4)
// - 回収後の state が年末 integrity (R1-R6) を通る

import { describe, expect, it } from 'vitest'
import { createPersonId, createHouseId, createPolityId, createRegimentId } from '../types/ids'
import type { HoldingId, RegimentBarracksId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Regiment } from '../types/regiment'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createPoliticalRight } from '../mutations/politicalRightMutations'
import { markPersonDead } from '../mutations/personMutations'
import { disbandRegimentMut } from '../mutations/regimentMutations'
import { runRightConsistencySystem, findRightInconsistency } from './rightConsistencySystem'
import { getEffectiveOfficeMaxHolders } from '../selectors/officeSelectors'
import { checkPoliticalRights } from './integrityRightChecks'
import type { SimError } from '../mutations/errors'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withHolding,
  withProvince,
} from '../testFixtures'

const polityId = createPolityId('c', 0)
const polity2Id = createPolityId('c', 1)
const houseId = createHouseId('h', 0)
const personId = createPersonId('pe', 0)
const holdingId = 'hl-0' as HoldingId
const regimentId = createRegimentId(0)
const provinceId = 'pr-0' as Parameters<typeof withProvince>[1]

function makeRegiment(overrides: Partial<Regiment> = {}): Regiment {
  return {
    id: regimentId,
    owner: { kind: 'polity', id: polityId },
    status: 'active',
    sourceKind: 'levy',
    troopKind: 'infantry',
    barracksId: 'bk-0' as RegimentBarracksId,
    strength: 100,
    organization: 50,
    morale: 30,
    maxStrength: 100,
    basePower: 10,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
    ...overrides,
  }
}

function makeFixture(): WorldState {
  let state = makeEmptyV016State()
  state = withProvince(state, provinceId)
  state = withHouse(state, houseId)
  state = withPerson(state, personId, { houseId })
  state = withPolity(state, polityId, { ownerHouseId: houseId })
  state = withPolity(state, polity2Id, {})
  state = withHolding(state, holdingId, provinceId)
  state = {
    ...state,
    holdingTerminalPolityCache: { ...state.holdingTerminalPolityCache, [holdingId]: polityId },
    regiments: { [regimentId]: makeRegiment() },
    regimentIndex: {
      ...state.regimentIndex,
      byOwner: { [`polity:${polityId}`]: [regimentId] },
    },
  }
  return state
}

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

function grantRegimentRight(state: WorldState, holder: 'person' | 'house'): WorldState {
  const r = createPoliticalRight(state, {
    polityId,
    target: { kind: 'regiment', regimentId },
    holder: holder === 'person' ? { kind: 'person', id: personId } : { kind: 'house', id: houseId },
    grantedWeek: 100,
  })
  if (!r.ok) throw new Error('setup failed: ' + r.error.message)
  return r.value.state
}

function expectNoIntegrityViolations(state: WorldState): void {
  const errors: SimError[] = []
  checkPoliticalRights(state, errors)
  expect(errors.map((e) => e.message)).toEqual([])
}

describe('runRightConsistencySystem', () => {
  it('removes a right whose person holder is dead (safety net)', () => {
    let state = grantRegimentRight(makeFixture(), 'person')
    // cascade を経由しない死亡 (直接 alive=false) = drift を模す
    state = {
      ...state,
      persons: { ...state.persons, [personId]: { ...state.persons[personId]!, alive: false } },
    }
    const after = runRightConsistencySystem(makeCtx(state))
    expect(Object.keys(after.state.politicalRights)).toHaveLength(0)
    expectNoIntegrityViolations(after.state)
  })

  it('removes a right whose house holder is inactive (safety net)', () => {
    let state = grantRegimentRight(makeFixture(), 'house')
    state = {
      ...state,
      houses: { ...state.houses, [houseId]: { ...state.houses[houseId]!, active: false } },
    }
    const after = runRightConsistencySystem(makeCtx(state))
    expect(Object.keys(after.state.politicalRights)).toHaveLength(0)
    expectNoIntegrityViolations(after.state)
  })

  it('removes a regiment_control right when regiment owner polity changed (regime change)', () => {
    let state = grantRegimentRight(makeFixture(), 'house')
    // regimentMaintenance の owner 同期を模して owner を別 polity に付替
    state = {
      ...state,
      regiments: {
        [regimentId]: { ...state.regiments[regimentId]!, owner: { kind: 'polity', id: polity2Id } },
      },
    }
    const right = Object.values(state.politicalRights)[0]!
    expect(findRightInconsistency(state, defaultConfig, right)).toBe('regime_change')
    const after = runRightConsistencySystem(makeCtx(state))
    expect(Object.keys(after.state.politicalRights)).toHaveLength(0)
    expectNoIntegrityViolations(after.state)
  })

  it('removes a holding right when terminal polity changed', () => {
    const base = makeFixture()
    const r = createPoliticalRight(base, {
      polityId,
      target: { kind: 'holding_office_role', holdingId, role: 'bailiff' },
      holder: { kind: 'house', id: houseId },
      grantedWeek: 100,
    })
    if (!r.ok) throw new Error('setup failed')
    const state = {
      ...r.value.state,
      holdingTerminalPolityCache: { [holdingId]: polity2Id },
    }
    const after = runRightConsistencySystem(makeCtx(state))
    expect(Object.keys(after.state.politicalRights)).toHaveLength(0)
    expectNoIntegrityViolations(after.state)
  })

  it('keeps a regiment_control right when the regiment is destroyed (§11.4)', () => {
    let state = grantRegimentRight(makeFixture(), 'house')
    state = {
      ...state,
      regiments: {
        [regimentId]: { ...state.regiments[regimentId]!, status: 'destroyed', destroyedWeek: 200 },
      },
    }
    const right = Object.values(state.politicalRights)[0]!
    expect(findRightInconsistency(state, defaultConfig, right)).toBeUndefined()
    const after = runRightConsistencySystem(makeCtx(state))
    expect(Object.keys(after.state.politicalRights)).toHaveLength(1)
    expectNoIntegrityViolations(after.state)
  })

  it('removes a right whose polity went inactive (safety net)', () => {
    let state = grantRegimentRight(makeFixture(), 'house')
    state = {
      ...state,
      polities: { ...state.polities, [polityId]: { ...state.polities[polityId]!, active: false } },
    }
    const after = runRightConsistencySystem(makeCtx(state))
    expect(Object.keys(after.state.politicalRights)).toHaveLength(0)
    expectNoIntegrityViolations(after.state)
  })

  it('leaves consistent rights untouched (no-op fast path)', () => {
    const state = grantRegimentRight(makeFixture(), 'house')
    const ctx = makeCtx(state)
    const after = runRightConsistencySystem(ctx)
    expect(after).toBe(ctx) // 変更なしなら同一 ctx を返す
  })

  it('lapses office rights from the tail when effectiveMax shrinks, keeping slot 0 (v0.42 slot 化)', () => {
    // 静的 maxHolders (administrator=3) いっぱいまで slot right を作る。
    // fixture の polity は province 0 件 → effectiveMax = 1 (rank cap 3 × small factor 0.4)。
    let state = makeFixture()
    expect(
      getEffectiveOfficeMaxHolders(
        state,
        defaultConfig,
        { kind: 'polity', id: polityId },
        'administrator',
      ),
    ).toBe(1)
    for (const slotIndex of [0, 1, 2]) {
      const r = createPoliticalRight(state, {
        polityId,
        target: { kind: 'polity_office_role', polityId, role: 'administrator', slotIndex },
        holder: { kind: 'house', id: houseId },
        grantedWeek: 100,
      })
      if (!r.ok) throw new Error('setup failed: ' + r.error.message)
      state = r.value.state
    }

    const after = runRightConsistencySystem(makeCtx(state))
    const remaining = Object.values(after.state.politicalRights)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.target).toEqual({
      kind: 'polity_office_role',
      polityId,
      role: 'administrator',
      slotIndex: 0,
    })
    // 後ろの slot 2 件が target_lost で REVOKED される
    const revokedEvents = after.events.filter((e) => e.type === 'POLITICAL_RIGHT_REVOKED')
    expect(revokedEvents).toHaveLength(2)
    expectNoIntegrityViolations(after.state)
  })
})

describe('immediate cascades (§6.4)', () => {
  it('markPersonDead removes personal rights immediately', () => {
    const state = grantRegimentRight(makeFixture(), 'person')
    const result = markPersonDead(state, personId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.value.politicalRights)).toHaveLength(0)
    expectNoIntegrityViolations(result.value)
  })

  it('disbandRegimentMut removes regiment_control rights immediately', () => {
    const state = grantRegimentRight(makeFixture(), 'house')
    const ws: WorldState = {
      ...state,
      regiments: { ...state.regiments },
      regimentIndex: {
        ...state.regimentIndex,
        byWar: { ...state.regimentIndex.byWar },
      },
    }
    disbandRegimentMut(ws, regimentId)
    expect(ws.regiments[regimentId]!.status).toBe('disbanded')
    expect(Object.keys(ws.politicalRights)).toHaveLength(0)
    expectNoIntegrityViolations(ws)
    // 元 state の maps は変異していない (copy-on-write の検証)
    expect(Object.keys(state.politicalRights)).toHaveLength(1)
  })
})
