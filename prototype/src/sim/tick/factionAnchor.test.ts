// v0.42 §12 Faction polity anchor のユニットテスト (spec §20.1 factionAnchor.test)。
// - founding 時の polityId 決定: primary polity → seatProvince terminal fallback → 不成立
// - anchor Polity inactive で polityOwnerConsistency の deactivate cascade が即時解散すること

import { describe, expect, it } from 'vitest'
import {
  createHouseShareId,
  createPersonId,
  createHouseId,
  createPolityId,
  createProvinceId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { SimulationConfig } from '../config/defaultConfig'
import { runFactionLifecycleSystem } from './factionLifecycleSystem'
import { runPolityOwnerConsistencySystem } from './polityOwnerConsistencySystem'
import { createFaction } from '../mutations/factionMutations'
import { checkFactionsAndClans } from './integrityFactionClanChecks'
import type { SimError } from '../mutations/errors'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

const leaderId = createPersonId('pe', 0)
const member1Id = createPersonId('pe', 1)
const member2Id = createPersonId('pe', 2)
const houseId = createHouseId('dh', 0)
const otherHouseId = createHouseId('dh', 1)
const provinceId = createProvinceId('p', 0)
const polityId = createPolityId('dp', 0)

const lowThresholdConfig: SimulationConfig = {
  ...defaultConfig,
  factionFormationThreshold: 0,
  factionDisbandThreshold: 0,
}

function makeCtx(state: WorldState, config: SimulationConfig = lowThresholdConfig): TickContext {
  return {
    state,
    rng: createRng('test'),
    config,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

// founder 資格 (top shareholder / wealth / member 候補) を満たす共通 fixture。
// bindToHouse=true なら leader の家が polity を所有 (primary path)、
// false なら polity は otherHouse 所有で leader の家は土地なし (seat fallback path)。
function makeFoundingState(opts: { bindToHouse: boolean; withPolityAtSeat: boolean }): WorldState {
  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, provinceId, { nameKey: 'Province0' })
  s = withHouse(s, houseId, {
    nameKey: 'House0',
    memberIds: [leaderId, member1Id, member2Id],
    seatProvinceId: provinceId,
  })
  if (opts.withPolityAtSeat) {
    const ownerHouse = opts.bindToHouse ? houseId : otherHouseId
    if (!opts.bindToHouse) {
      s = withHouse(s, otherHouseId, { nameKey: 'House1', seatProvinceId: provinceId })
    }
    s = withPolity(s, polityId, { ownerHouseId: ownerHouse, capitalProvinceId: provinceId })
    s = bindProvinceToHouseViaPolity(s, provinceId, polityId, ownerHouse)
  }
  s = withPerson(s, leaderId, { nameKey: 'Leader', houseId, wealth: 1000, alive: true, age: 25 })
  s = withPerson(s, member1Id, { nameKey: 'Member1', houseId, wealth: 100, alive: true, age: 20 })
  s = withPerson(s, member2Id, { nameKey: 'Member2', houseId, wealth: 100, alive: true, age: 22 })

  // leader を家の top shareholder にする (founder 資格)
  const shareId = createHouseShareId(0)
  s = {
    ...s,
    houseShares: {
      ...s.houseShares,
      [shareId]: { id: shareId, houseId, holderPersonId: leaderId, rawPower: 100 },
    },
    houseShareIndex: {
      ...s.houseShareIndex,
      byHouse: { ...s.houseShareIndex.byHouse, [houseId]: [shareId] },
      byHolderPerson: { ...s.houseShareIndex.byHolderPerson, [leaderId]: [shareId] },
    },
  }
  return s
}

function expectNoFactionViolations(state: WorldState): void {
  const errors: SimError[] = []
  checkFactionsAndClans(state, errors)
  expect(errors.map((e) => e.message)).toEqual([])
}

describe('faction founding anchor decision (§12.2)', () => {
  it('anchors to the leader house primary polity when the house owns one', () => {
    const state = makeFoundingState({ bindToHouse: true, withPolityAtSeat: true })
    const result = runFactionLifecycleSystem(makeCtx(state))
    const active = Object.values(result.state.factions).filter((f) => f?.active)
    expect(active.length).toBeGreaterThan(0)
    expect(active[0]!.polityId).toBe(polityId)
    expect(result.state.factionIndex.byPolity[polityId]).toContain(active[0]!.id)
    expectNoFactionViolations(result.state)
  })

  it('falls back to the seatProvince terminal polity when the house owns no polity', () => {
    const state = makeFoundingState({ bindToHouse: false, withPolityAtSeat: true })
    const result = runFactionLifecycleSystem(makeCtx(state))
    const active = Object.values(result.state.factions).filter((f) => f?.active)
    expect(active.length).toBeGreaterThan(0)
    expect(active[0]!.polityId).toBe(polityId)
    expectNoFactionViolations(result.state)
  })

  it('does not create a faction when no anchor polity can be determined', () => {
    const state = makeFoundingState({ bindToHouse: false, withPolityAtSeat: false })
    const result = runFactionLifecycleSystem(makeCtx(state))
    const active = Object.values(result.state.factions).filter((f) => f?.active)
    expect(active.length).toBe(0)
  })

  it('createFaction rejects an inactive anchor polity', () => {
    let state = makeFoundingState({ bindToHouse: true, withPolityAtSeat: true })
    state = {
      ...state,
      polities: { ...state.polities, [polityId]: { ...state.polities[polityId]!, active: false } },
    }
    const result = createFaction(makeCtx(state), {
      leaderPersonId: leaderId,
      polityId,
      week: state.absoluteWeek,
    })
    expect(result.ok).toBe(false)
  })
})

describe('anchor polity deactivation cascade (§12.3)', () => {
  it('dissolves anchored factions immediately when the polity is titularized', () => {
    // founding まで通してから polity を landless 化し、polityOwnerConsistency を回す。
    // v0.47 §6.1: landless rank 2〜4 normal Polity は deactivate ではなく titular 化されるが、
    //   anchor された faction は titularizePolityInline の cleanup で同様に解散される。
    const state = makeFoundingState({ bindToHouse: true, withPolityAtSeat: true })
    const founded = runFactionLifecycleSystem(makeCtx(state))
    const faction = Object.values(founded.state.factions).find((f) => f?.active)
    expect(faction).toBeDefined()
    if (!faction) return

    // polity を landless にする (LandContract を全削除 → titular 化経路)
    const landless: WorldState = {
      ...founded.state,
      landContracts: {},
      landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
      holdingTerminalPolityCache: {},
    }
    const result = runPolityOwnerConsistencySystem(makeCtx(landless))

    // v0.47: rank 2〜4 は titular 化 (active 維持・territorialStatus='titular')
    expect(result.state.polities[polityId]!.active).toBe(true)
    expect(result.state.polities[polityId]!.territorialStatus).toBe('titular')
    const after = result.state.factions[faction.id]!
    expect(after.active).toBe(false)
    // membership は全削除される (deactivateFaction)
    const memberships = Object.values(result.state.factionMemberships).filter(
      (m) => m && m.factionId === faction.id,
    )
    expect(memberships).toHaveLength(0)
    // FACTION_DISSOLVED が発火する
    expect(result.events.some((e) => e.type === 'FACTION_DISSOLVED')).toBe(true)
    // F8: inactive faction は polityId が inactive polity を指していても違反にならない
    expectNoFactionViolations(result.state)
  })
})
