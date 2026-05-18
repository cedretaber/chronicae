import { describe, expect, it } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runFactionLifecycleSystem } from './factionLifecycleSystem'
import {
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
  state = { ...state, currentYear: 1444, currentMonth: 1 }
  state = withProvince(state, provinceId, { name: 'Province0' })
  state = withHouse(state, houseId, {
    name: 'House0',
    memberIds: [leaderId],
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, {
    name: 'Polity0',
    ownerHouseId: houseId,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  state = withPerson(state, leaderId, { name: 'Leader', houseId, wealth: 1000, alive: true })

  return { state, leaderId, provinceId, polityId, houseId }
}

function addFaction(
  state: WorldState,
  factionId: import('../types/ids').FactionId,
  leaderPersonId: PersonId,
): { state: WorldState; faction: Faction } {
  const faction: Faction = {
    id: factionId,
    name: 'Faction0',
    leaderPersonId,
    active: true,
    foundingYear: 1444,
    foundingMonth: 1,
  }
  const membership: FactionMembership = {
    id: createFactionMembershipId(0),
    factionId,
    personId: leaderPersonId,
    active: true,
    joinedYear: 1444,
    joinedMonth: 1,
  }
  const newIndex: import('../types/faction').FactionIndex = {
    byLeader: { ...state.factionIndex.byLeader, [leaderPersonId]: [factionId] },
    byMember: { ...state.factionIndex.byMember, [leaderPersonId]: [createFactionMembershipId(0)] },
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
  it('returns identity when month != 1', () => {
    const { state } = buildBaseState()
    const month12State: WorldState = { ...state, currentMonth: 12 }
    const ctx = makeCtx(month12State)
    const result = runFactionLifecycleSystem(ctx)

    expect(result.state).toBe(month12State)
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
    s = { ...s, currentYear: 1444, currentMonth: 1 }
    s = withProvince(s, provinceId, { name: 'Province0' })
    s = withHouse(s, houseId, {
      name: 'House0',
      memberIds: [leaderId, member1Id, member2Id],
      seatProvinceId: provinceId,
    })
    s = withPolity(s, polityId, {
      name: 'Polity0',
      ownerHouseId: houseId,
      capitalProvinceId: provinceId,
    })
    s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
    s = withPerson(s, leaderId, { name: 'Leader', houseId, wealth: 1000, alive: true, age: 25 })
    s = withPerson(s, member1Id, { name: 'Member1', houseId, wealth: 100, alive: true, age: 20 })
    s = withPerson(s, member2Id, { name: 'Member2', houseId, wealth: 100, alive: true, age: 22 })

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
    s = withPerson(s, member1Id, { name: 'Member1', houseId, wealth: 100, alive: true, age: 20 })

    // Add faction with leader
    const { state: s2 } = addFaction(s, factionId, leaderId)

    // Kill the leader
    const deadLeader = s2.persons[leaderId]!
    const s3: WorldState = {
      ...s2,
      persons: { ...s2.persons, [leaderId]: { ...deadLeader, alive: false } },
    }

    const ctx = makeCtx(s3)
    const result = runFactionLifecycleSystem(ctx)

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
    s = withPerson(s, member1Id, { name: 'Member1', houseId, wealth: 100, alive: true, age: 20 })

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
})
