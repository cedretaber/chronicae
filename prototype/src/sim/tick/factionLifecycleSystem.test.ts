import { describe, expect, it } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runFactionLifecycleSystem } from './factionLifecycleSystem'
import { runFactionMaintenanceSystem } from './factionMaintenanceSystem'
import {
  createHouseShareId,
  createHouseId,
  createPersonId,
  createFactionId,
  createFactionMembershipId,
  createProvinceId,
  createPolityId,
} from '../types/ids'
import type { PersonId, ProvinceId, PolityId, HouseId } from '../types/ids'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Faction, FactionMembership } from '../types/faction'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

function makeCtx(state: WorldState, overrides?: Partial<Pick<TickContext, 'config'>>): TickContext {
  return {
    state,
    rng: createRng('faction-lifecycle-test'),
    config: overrides?.config ?? defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
  }
}

function buildBaseState(): {
  state: WorldState
  leaderId: PersonId
  provinceId: ProvinceId
  polityId: PolityId
  houseId: HouseId
} {
  const leaderId = createPersonId('pe', 0)
  const provinceId = createProvinceId('p', 0)
  const polityId = createPolityId('dp', 0)
  const houseId = createHouseId('dh', 0)

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  state = withProvince(state, provinceId, { nameKey: 'Province0' })
  state = withHouse(state, houseId, {
    nameKey: 'House0',
    memberIds: [leaderId],
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, {
    ownerHouseId: houseId,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  state = withPerson(state, leaderId, { nameKey: 'Leader', houseId, wealth: 1000, alive: true })

  return { state, leaderId, provinceId, polityId, houseId }
}

function addFaction(
  state: WorldState,
  factionId: import('../types/ids').FactionId,
  leaderPersonId: PersonId,
): { state: WorldState; faction: Faction } {
  const faction: Faction = {
    id: factionId,
    leaderPersonId,
    polityId: createPolityId('dp', 0),
    active: true,
    foundingWeek: 69312,
  }
  const membership: FactionMembership = {
    id: createFactionMembershipId(0),
    factionId,
    personId: leaderPersonId,
    active: true,
    joinedWeek: 69312,
  }
  const newIndex: import('../types/faction').FactionIndex = {
    byLeader: { ...state.factionIndex.byLeader, [leaderPersonId]: [factionId] },
    byMember: { ...state.factionIndex.byMember, [leaderPersonId]: [createFactionMembershipId(0)] },
    byPolity: { ...state.factionIndex.byPolity, [createPolityId('dp', 0)]: [factionId] },
  }
  return {
    state: {
      ...state,
      factions: { ...state.factions, [factionId]: faction },
      factionMemberships: {
        ...state.factionMemberships,
        [createFactionMembershipId(0)]: membership,
      },
      factionIndex: newIndex,
    },
    faction,
  }
}

describe('runFactionLifecycleSystem', () => {
  it('returns identity when currentWeekOfYear != 1', () => {
    const { state } = buildBaseState()
    const week12State: WorldState = { ...state, currentWeekOfYear: 12 }
    const ctx = makeCtx(week12State)
    const result = runFactionLifecycleSystem(ctx)

    expect(result.state).toBe(week12State)
  })

  it('no eligible founder → no faction created', () => {
    const { state } = buildBaseState()
    // Leader wealth is too low (below minimumFactionFounderWealth = 50 by default, but we have 1000)
    // Actually let's make the person too young
    const leaderId = createPersonId('pe', 0)
    const s: WorldState = {
      ...state,
      persons: { ...state.persons, [leaderId]: { ...state.persons[leaderId]!, age: 10 } },
    }
    const ctx = makeCtx(s)
    const result = runFactionLifecycleSystem(ctx)

    // No faction should be created (age < adultAge)
    const activeFactions = Object.values(result.state.factions).filter((f) => f?.active)
    expect(activeFactions.length).toBe(0)
  })

  it('eligible founder with opportunity above threshold + enough candidate members → faction created', () => {
    const config = defaultConfig
    const configWithLowThreshold = {
      ...config,
      factionFormationThreshold: 0,
      factionDisbandThreshold: 0,
    }

    const leaderId = createPersonId('pe', 0)
    const member1Id = createPersonId('pe', 1)
    const member2Id = createPersonId('pe', 2)
    const houseId = createHouseId('dh', 0)
    const provinceId = createProvinceId('p', 0)
    const polityId = createPolityId('dp', 0)

    let s = makeEmptyV016State()
    s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    s = withProvince(s, provinceId, { nameKey: 'Province0' })
    s = withHouse(s, houseId, {
      nameKey: 'House0',
      memberIds: [leaderId, member1Id, member2Id],
      seatProvinceId: provinceId,
    })
    s = withPolity(s, polityId, {
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    })
    s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
    s = withPerson(s, leaderId, { nameKey: 'Leader', houseId, wealth: 1000, alive: true, age: 25 })
    s = withPerson(s, member1Id, { nameKey: 'Member1', houseId, wealth: 100, alive: true, age: 20 })
    s = withPerson(s, member2Id, { nameKey: 'Member2', houseId, wealth: 100, alive: true, age: 22 })

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

    const ctx = makeCtx(s, { config: configWithLowThreshold })
    const result = runFactionLifecycleSystem(ctx)

    // Check that a faction was created
    const activeFactions = Object.values(result.state.factions).filter((f) => f?.active)
    expect(activeFactions.length).toBeGreaterThan(0)

    // Leader should have a membership
    const leaderMembership = result.state.factionIndex.byMember[leaderId]
    expect(leaderMembership).toBeDefined()
    expect(leaderMembership!.length).toBeGreaterThan(0)

    // Check that FACTION_FOUNDED event was emitted
    const foundedEvents = result.events.filter((e) => e.type === 'FACTION_FOUNDED')
    expect(foundedEvents.length).toBeGreaterThan(0)

    // Check that both directions of attitude keys are set
    const leaderPerson = result.state.persons[leaderId]!
    const member1Person = result.state.persons[member1Id]!
    const leaderToMemberKey = `person:${member1Id}`
    const memberToLeaderKey = `person:${leaderId}`
    expect(leaderPerson.attitudes[leaderToMemberKey]).toBeDefined()
    expect(member1Person.attitudes[memberToLeaderKey]).toBeDefined()
  })

  it('existing faction, leader dies (alive=false) → handleLeaderVacancy picks successor or dissolves', () => {
    const { state, leaderId, houseId } = buildBaseState()
    const factionId = createFactionId(0)

    // Add a member to the faction
    const member1Id = createPersonId('pe', 1)
    let s = state
    s = withPerson(s, member1Id, { nameKey: 'Member1', houseId, wealth: 100, alive: true, age: 20 })

    // Add faction with leader
    const { state: s2 } = addFaction(s, factionId, leaderId)

    // Kill the leader
    const deadLeader = s2.persons[leaderId]!
    const s3: WorldState = {
      ...s2,
      persons: { ...s2.persons, [leaderId]: { ...deadLeader, alive: false } },
    }

    const ctx = makeCtx(s3)
    const result = runFactionMaintenanceSystem(ctx)

    // After processing, either the faction dissolved or a successor was chosen
    const faction = result.state.factions[factionId]
    if (faction && faction.active) {
      // Leader should have changed
      expect(faction.leaderPersonId).not.toBe(leaderId)
    } else {
      // Faction dissolved
      expect(faction?.active).toBe(false)
    }
  })

  it('existing faction with member count < minimumFactionMembers → FACTION_DISSOLVED', () => {
    const { state, leaderId } = buildBaseState()
    const factionId = createFactionId(0)

    const { state: s2 } = addFaction(state, factionId, leaderId)

    // Set config to require 2 minimum members
    const config = { ...defaultConfig, minimumFactionMembers: 2, factionDisbandThreshold: 0 }
    const ctx = makeCtx(s2, { config })
    const result = runFactionLifecycleSystem(ctx)

    // Faction should be dissolved
    const faction = result.state.factions[factionId]
    expect(faction?.active).toBe(false)

    // FACTION_DISSOLVED event should be emitted
    const dissolvedEvents = result.events.filter((e) => e.type === 'FACTION_DISSOLVED')
    expect(dissolvedEvents.length).toBeGreaterThan(0)
  })

  it('existing faction with leader.wealth < factionDisbandWealthFloor → dissolved', () => {
    const { state, leaderId, houseId } = buildBaseState()
    const factionId = createFactionId(0)

    // Add a member
    const member1Id = createPersonId('pe', 1)
    let s = state
    s = withPerson(s, member1Id, { nameKey: 'Member1', houseId, wealth: 100, alive: true, age: 20 })

    // Add faction
    const { state: s2 } = addFaction(s, factionId, leaderId)

    // Make leader bankrupt
    const deadLeader = s2.persons[leaderId]!
    const s3: WorldState = {
      ...s2,
      persons: { ...s2.persons, [leaderId]: { ...deadLeader, wealth: 1 } },
    }

    const config = { ...defaultConfig, factionDisbandWealthFloor: 10, factionDisbandThreshold: 0 }
    const ctx = makeCtx(s3, { config })
    const result = runFactionLifecycleSystem(ctx)

    const faction = result.state.factions[factionId]
    expect(faction?.active).toBe(false)

    const dissolvedEvents = result.events.filter((e) => e.type === 'FACTION_DISSOLVED')
    expect(dissolvedEvents.length).toBeGreaterThan(0)
  })

  it('v0.17.4: FACTION_LEADER_BANKRUPT fires before FACTION_DISSOLVED when leader bankrupt', () => {
    const { state, leaderId, houseId } = buildBaseState()
    const factionId = createFactionId(0)
    const member1Id = createPersonId('pe', 1)
    let s = state
    s = withPerson(s, member1Id, { nameKey: 'Member1', houseId, wealth: 100, alive: true, age: 20 })
    const { state: s2 } = addFaction(s, factionId, leaderId)
    const s3: WorldState = {
      ...s2,
      persons: { ...s2.persons, [leaderId]: { ...s2.persons[leaderId]!, wealth: 1 } },
    }

    const config = { ...defaultConfig, factionDisbandWealthFloor: 10, factionDisbandThreshold: 0 }
    const ctx = makeCtx(s3, { config })
    const result = runFactionLifecycleSystem(ctx)

    const bankruptIdx = result.events.findIndex((e) => e.type === 'FACTION_LEADER_BANKRUPT')
    const dissolvedIdx = result.events.findIndex((e) => e.type === 'FACTION_DISSOLVED')
    expect(bankruptIdx).toBeGreaterThanOrEqual(0)
    expect(dissolvedIdx).toBeGreaterThanOrEqual(0)
    expect(bankruptIdx).toBeLessThan(dissolvedIdx)
    expect(result.events[bankruptIdx]?.entityRefs.find((r) => r.kind === 'person')?.id).toBe(
      leaderId,
    )
  })

  it('v0.17.4: dead member membership is removed during processExistingFactions', () => {
    const { state, leaderId, houseId } = buildBaseState()
    const factionId = createFactionId(0)
    const deadMemberId = createPersonId('pe', 1)
    const aliveMemberId = createPersonId('pe', 2)
    const deadMembershipId = createFactionMembershipId(1)
    const aliveMembershipId = createFactionMembershipId(2)

    let s = state
    s = withPerson(s, deadMemberId, { nameKey: 'Dead', houseId, wealth: 0, alive: false, age: 70 })
    s = withPerson(s, aliveMemberId, { nameKey: 'Alive', houseId, wealth: 0, alive: true, age: 25 })
    const { state: s2 } = addFaction(s, factionId, leaderId)

    // 手動で 2 membership 追加 (helper は leaderMembership だけ作るので拡張)
    const deadM = {
      id: deadMembershipId,
      factionId,
      personId: deadMemberId,
      active: true,
      joinedWeek: 69312,
    }
    const aliveM = {
      id: aliveMembershipId,
      factionId,
      personId: aliveMemberId,
      active: true,
      joinedWeek: 69312,
    }
    const s3: WorldState = {
      ...s2,
      factionMemberships: {
        ...s2.factionMemberships,
        [deadMembershipId]: deadM,
        [aliveMembershipId]: aliveM,
      },
      factionIndex: {
        byLeader: s2.factionIndex.byLeader,
        byMember: {
          ...s2.factionIndex.byMember,
          [deadMemberId]: [deadMembershipId],
          [aliveMemberId]: [aliveMembershipId],
        },
        byPolity: s2.factionIndex.byPolity,
      },
    }

    const ctx = makeCtx(s3)
    const result = runFactionMaintenanceSystem(ctx)

    // 死亡 member の membership は完全削除 (v0.17.3 C: deleted)
    expect(result.state.factionMemberships[deadMembershipId]).toBeUndefined()
    // 生存 member の membership は残る
    expect(result.state.factionMemberships[aliveMembershipId]?.active).toBe(true)
    // byMember index も同期
    expect(result.state.factionIndex.byMember[deadMemberId]).toEqual([])
    expect(result.state.factionIndex.byMember[aliveMemberId]).toContain(aliveMembershipId)
  })

  it('v0.17.4: FACTION_LEADER_BANKRUPT does NOT fire when dissolved by other reasons', () => {
    const { state, leaderId, houseId } = buildBaseState()
    const factionId = createFactionId(0)
    // leader 単独 (member 0 < minimumFactionMembers=2) で解散される、leader wealth は十分
    let s = state
    // ensure leader stays wealthy
    s = { ...s, persons: { ...s.persons, [leaderId]: { ...s.persons[leaderId]!, wealth: 10000 } } }
    s = withPerson(s, createPersonId('pe', 1), {
      nameKey: 'Other',
      houseId,
      wealth: 0,
      alive: true,
      age: 20,
    })
    const { state: s2 } = addFaction(s, factionId, leaderId)

    const config = {
      ...defaultConfig,
      minimumFactionMembers: 5,
      factionDisbandWealthFloor: 10,
      factionDisbandThreshold: 0,
    }
    const ctx = makeCtx(s2, { config })
    const result = runFactionLifecycleSystem(ctx)

    expect(result.events.filter((e) => e.type === 'FACTION_LEADER_BANKRUPT')).toHaveLength(0)
    expect(result.events.filter((e) => e.type === 'FACTION_DISSOLVED').length).toBeGreaterThan(0)
  })
})
