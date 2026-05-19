import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createFactionId,
  createFactionMembershipId,
} from '../types/ids'
import type { PersonId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import {
  createFaction,
  addFactionMembership,
  deactivateFaction,
  transitionFactionLeader,
  removeFactionMembership,
} from './factionMutations'
import { makeEmptyV016State, withPerson, withHouse } from '../testFixtures'

function makeFixture(): {
  state: WorldState
  ctx: TickContext
  leaderId: PersonId
  member1Id: PersonId
  member2Id: PersonId
  houseId: HouseId
} {
  const leaderId = createPersonId('pe', 0)
  const member1Id = createPersonId('pe', 1)
  const member2Id = createPersonId('pe', 2)
  const houseId = createHouseId('h', 0)

  let state = makeEmptyV016State()
  state = withHouse(state, houseId, {
    name: 'Test House',
    memberIds: [leaderId, member1Id, member2Id],
  })
  state = withPerson(state, leaderId, { name: 'Leader', houseId, alive: true })
  state = withPerson(state, member1Id, { name: 'Member1', houseId, alive: true })
  state = withPerson(state, member2Id, { name: 'Member2', houseId, alive: true })

  const ctx: TickContext = {
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
  return { state, ctx, leaderId, member1Id, member2Id, houseId }
}

describe('createFaction', () => {
  it('creates faction + leader membership when leader is valid', () => {
    const { ctx, leaderId } = makeFixture()
    const result = createFaction(ctx, {
      leaderPersonId: leaderId,
      name: 'Test Faction',
      year: 1444,
      month: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { factionId, leaderMembershipId } = result.value.value
    const newState = result.value.ctx.state

    const faction = newState.factions[factionId]
    expect(faction).toBeDefined()
    expect(faction!.name).toBe('Test Faction')
    expect(faction!.active).toBe(true)
    expect(faction!.leaderPersonId).toBe(leaderId)
    expect(faction!.foundingYear).toBe(1444)

    const membership = newState.factionMemberships[leaderMembershipId]
    expect(membership).toBeDefined()
    expect(membership!.factionId).toBe(factionId)
    expect(membership!.personId).toBe(leaderId)
    expect(membership!.active).toBe(true)

    expect(newState.factionIndex.byLeader[leaderId]).toContain(factionId)
    expect(newState.factionIndex.byMember[leaderId]).toContain(leaderMembershipId)
    expect(newState.nextFactionId).toBe(1)
    expect(newState.nextFactionMembershipId).toBe(1)
  })

  it('returns err when leader is dead', () => {
    const { ctx, leaderId } = makeFixture()
    const deadState = {
      ...ctx.state,
      persons: {
        ...ctx.state.persons,
        [leaderId]: { ...ctx.state.persons[leaderId]!, alive: false },
      },
    }
    const deadCtx: TickContext = { ...ctx, state: deadState }
    const result = createFaction(deadCtx, {
      leaderPersonId: leaderId,
      name: 'Test Faction',
      year: 1444,
      month: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_DEAD')
  })

  it('returns err when leader is placeholder', () => {
    const { ctx, leaderId } = makeFixture()
    const placeholderState = {
      ...ctx.state,
      persons: {
        ...ctx.state.persons,
        [leaderId]: { ...ctx.state.persons[leaderId]!, kind: 'placeholder' },
      },
    }
    const placeholderCtx: TickContext = { ...ctx, state: placeholderState }
    const result = createFaction(placeholderCtx, {
      leaderPersonId: leaderId,
      name: 'Test Faction',
      year: 1444,
      month: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PLACEHOLDER_PERSON')
  })

  it('returns err when leader already has active membership', () => {
    const { ctx, leaderId } = makeFixture()
    // Create a faction first for the leader
    const first = createFaction(ctx, {
      leaderPersonId: leaderId,
      name: 'First Faction',
      year: 1444,
      month: 1,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Try to create another faction with the same leader
    const second = createFaction(first.value.ctx, {
      leaderPersonId: leaderId,
      name: 'Second Faction',
      year: 1445,
      month: 1,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('FACTION_MEMBERSHIP_CONFLICT')
  })
})

describe('addFactionMembership', () => {
  it('creates active membership for valid person', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    const result = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      year: 1444,
      month: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const membership = result.value.state.factionMemberships[result.value.membershipId]
    expect(membership).toBeDefined()
    expect(membership!.active).toBe(true)
    expect(membership!.factionId).toBe(factionId)
    expect(membership!.personId).toBe(member1Id)
    expect(result.value.state.factionIndex.byMember[member1Id]).toContain(result.value.membershipId)
  })

  it('returns err when person already has active membership', () => {
    const { ctx, leaderId, member1Id } = makeFixture()
    // First faction with leader
    const first = createFaction(ctx, {
      leaderPersonId: leaderId,
      name: 'First',
      year: 1444,
      month: 1,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const factionId = first.value.value.factionId

    // Add member1 as member
    const addResult = addFactionMembership(first.value.ctx.state, {
      factionId,
      personId: member1Id,
      year: 1444,
      month: 2,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return

    // Try to add member1 to another faction
    const faction2Id = createFactionId(1)
    const stateWithFaction2 = {
      ...addResult.value.state,
      factions: {
        ...addResult.value.state.factions,
        [faction2Id]: {
          id: faction2Id,
          name: 'Second',
          leaderPersonId: createPersonId('pe', 99),
          active: true,
          foundingYear: 1444,
          foundingMonth: 1,
        },
      },
    }
    const result = addFactionMembership(stateWithFaction2, {
      factionId: faction2Id,
      personId: member1Id,
      year: 1444,
      month: 3,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_CONFLICT')
  })

  it('returns err when person is the faction leader', () => {
    const { state, leaderId } = makeFixture()
    const factionId = createFactionId(0)
    state.factions[factionId] = {
      id: factionId,
      name: 'Test',
      leaderPersonId: leaderId,
      active: true,
      foundingYear: 1444,
      foundingMonth: 1,
    }
    const result = addFactionMembership(state, {
      factionId,
      personId: leaderId,
      year: 1444,
      month: 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_LEADER_MEMBERSHIP_EXISTS')
  })
})

describe('deactivateFaction', () => {
  it('sets faction.active to false and all memberships inactive', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // Add a member
    const addResult = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      year: 1444,
      month: 2,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return

    const result = deactivateFaction(addResult.value.state, factionId)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.factions[factionId]!.active).toBe(false)
    // v0.17.3 C: Leader and member memberships are now deleted (not just set inactive)
    const leaderMembershipId = createFactionMembershipId(0)
    expect(result.value.factionMemberships[leaderMembershipId]).toBeUndefined()
    const memberMembershipId = createFactionMembershipId(1)
    expect(result.value.factionMemberships[memberMembershipId]).toBeUndefined()
    // byMember index cleaned
    expect(result.value.factionIndex.byMember[leaderId] ?? []).not.toContain(leaderMembershipId)
    expect(result.value.factionIndex.byMember[member1Id] ?? []).not.toContain(memberMembershipId)
  })

  it('is a no-op when faction already inactive', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    const first = deactivateFaction(factionResult.value.ctx.state, factionId)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = deactivateFaction(first.value, factionId)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value).toBe(first.value)
  })

  it('returns err when faction not found', () => {
    const { state } = makeFixture()
    const result = deactivateFaction(state, createFactionId(99))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_NOT_FOUND')
  })
})

describe('transitionFactionLeader', () => {
  it('updates faction.leaderPersonId and index', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // Add member1 as member
    const addResult = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      year: 1444,
      month: 2,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return

    const result = transitionFactionLeader(addResult.value.state, {
      factionId,
      newLeaderPersonId: member1Id,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const faction = result.value.factions[factionId]
    expect(faction!.leaderPersonId).toBe(member1Id)

    // v0.17.3 C: Old leader's membership is now deleted (not just set inactive)
    const oldLeaderMembershipId = createFactionMembershipId(0)
    expect(result.value.factionMemberships[oldLeaderMembershipId]).toBeUndefined()

    // byLeader index updated for both
    expect(result.value.factionIndex.byLeader[member1Id]).toContain(factionId)
    expect(result.value.factionIndex.byLeader[leaderId]).not.toContain(factionId)
    // byMember index cleaned for old leader
    expect(result.value.factionIndex.byMember[leaderId] ?? []).not.toContain(oldLeaderMembershipId)
  })

  it('is a no-op when new leader is same as old', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    const result = transitionFactionLeader(factionResult.value.ctx.state, {
      factionId,
      newLeaderPersonId: leaderId,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(factionResult.value.ctx.state)
  })

  it('returns err when new leader not in faction', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // member1 is NOT an active member of this faction (just in the same house)
    const result = transitionFactionLeader(factionResult.value.ctx.state, {
      factionId,
      newLeaderPersonId: member1Id,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_NOT_FOUND')
  })
})

describe('removeFactionMembership', () => {
  it('deactivates non-leader membership', () => {
    const { state, leaderId, member1Id } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const factionId = factionResult.value.value.factionId

    // Add member1 as member
    const addResult = addFactionMembership(factionResult.value.ctx.state, {
      factionId,
      personId: member1Id,
      year: 1444,
      month: 2,
    })
    expect(addResult.ok).toBe(true)
    if (!addResult.ok) return
    const membershipId = addResult.value.membershipId

    const result = removeFactionMembership(addResult.value.state, membershipId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // v0.17.3 C: membership is now deleted (not just set inactive)
    expect(result.value.factionMemberships[membershipId]).toBeUndefined()
    expect(result.value.factionIndex.byMember[member1Id] ?? []).not.toContain(membershipId)
  })

  it('is a no-op when membership already deleted (after deactivateFaction)', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const leaderMembershipId = factionResult.value.value.leaderMembershipId

    // Deactivate first — this DELETES all memberships including the leader's
    const deactivated = deactivateFaction(
      factionResult.value.ctx.state,
      factionResult.value.value.factionId,
    )
    expect(deactivated.ok).toBe(true)
    if (!deactivated.ok) return

    // v0.17.3 C: deleted membership → FACTION_MEMBERSHIP_NOT_FOUND
    const result = removeFactionMembership(deactivated.value, leaderMembershipId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_NOT_FOUND')
  })

  it('returns err when trying to remove leader membership', () => {
    const { state, leaderId } = makeFixture()
    const factionResult = createFaction(
      { ...makeFixture().ctx, state },
      { leaderPersonId: leaderId, name: 'Test', year: 1444, month: 1 },
    )
    expect(factionResult.ok).toBe(true)
    if (!factionResult.ok) return
    const leaderMembershipId = factionResult.value.value.leaderMembershipId

    const result = removeFactionMembership(factionResult.value.ctx.state, leaderMembershipId)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_LEADER_MEMBERSHIP_PROTECTED')
  })

  it('returns err when membership not found', () => {
    const { state } = makeFixture()
    const result = removeFactionMembership(state, createFactionMembershipId(99))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FACTION_MEMBERSHIP_NOT_FOUND')
  })
})
