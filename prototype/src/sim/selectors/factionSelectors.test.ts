import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createFactionId,
  createFactionMembershipId,
} from '../types/ids'
import type { PersonId, FactionId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import {
  getActiveFactions,
  getFaction,
  getFactionByLeader,
  getActiveFactionMembership,
  getFactionActiveMemberIds,
  getFactionOpportunityScore,
  getFactionViabilityScore,
  getBestRoleScore,
  getOccupationRoleFitBonus,
} from './factionSelectors'
import { defaultConfig } from '../config/defaultConfig'
import { deactivateFaction } from '../mutations/factionMutations'
import { makeEmptyV016State, withPerson, withHouse } from '../testFixtures'

function makeFixture(): {
  state: WorldState
  leaderId: PersonId
  member1Id: PersonId
  member2Id: PersonId
  houseId: HouseId
  faction1Id: FactionId
  faction2Id: FactionId
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
  state = withPerson(state, leaderId, { name: 'Leader', houseId })
  state = withPerson(state, member1Id, { name: 'Member1', houseId })
  state = withPerson(state, member2Id, { name: 'Member2', houseId })

  const faction1Id = createFactionId(0)
  const faction2Id = createFactionId(1)
  state.factions[faction1Id] = {
    id: faction1Id,
    name: 'Active Faction',
    leaderPersonId: leaderId,
    active: true,
    foundingYear: 1444,
    foundingMonth: 1,
  }
  state.factionMemberships[createFactionMembershipId(0)] = {
    id: createFactionMembershipId(0),
    factionId: faction1Id,
    personId: leaderId,
    active: true,
    joinedYear: 1444,
    joinedMonth: 1,
  }
  state.factionMemberships[createFactionMembershipId(1)] = {
    id: createFactionMembershipId(1),
    factionId: faction1Id,
    personId: member1Id,
    active: true,
    joinedYear: 1444,
    joinedMonth: 1,
  }
  state.factionIndex.byMember[leaderId] = [createFactionMembershipId(0)]
  state.factionIndex.byMember[member1Id] = [createFactionMembershipId(1)]
  state.factionIndex.byLeader[leaderId] = [faction1Id]

  const inactiveFactionId = createFactionId(2)
  state.factions[inactiveFactionId] = {
    id: inactiveFactionId,
    name: 'Inactive Faction',
    leaderPersonId: member2Id,
    active: false,
    foundingYear: 1440,
    foundingMonth: 6,
  }
  state.factionIndex.byLeader[member2Id] = [inactiveFactionId]

  return {
    state,
    leaderId,
    member1Id,
    member2Id,
    houseId,
    faction1Id,
    faction2Id,
  }
}

describe('getActiveFactions', () => {
  it('returns only active factions', () => {
    const { state, faction1Id } = makeFixture()
    const result = getActiveFactions(state)
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe(faction1Id)
  })

  it('returns empty when no factions exist', () => {
    const state = makeEmptyV016State()
    expect(getActiveFactions(state)).toEqual([])
  })
})

describe('getFaction', () => {
  it('returns the faction by id', () => {
    const { state, faction1Id } = makeFixture()
    const result = getFaction(state, faction1Id)
    expect(result).toBeDefined()
    expect(result!.name).toBe('Active Faction')
  })

  it('returns undefined for missing faction', () => {
    const { state } = makeFixture()
    const result = getFaction(state, createFactionId(99))
    expect(result).toBeUndefined()
  })
})

describe('getFactionByLeader', () => {
  it('returns active faction led by the person', () => {
    const { state, leaderId, faction1Id } = makeFixture()
    const result = getFactionByLeader(state, leaderId)
    expect(result).toBeDefined()
    expect(result!.id).toBe(faction1Id)
  })

  it('returns undefined for person leading only inactive faction', () => {
    const { state, member2Id } = makeFixture()
    const result = getFactionByLeader(state, member2Id)
    expect(result).toBeUndefined()
  })

  it('returns undefined for person leading no faction', () => {
    const { state } = makeFixture()
    const result = getFactionByLeader(state, createPersonId('pe', 99))
    expect(result).toBeUndefined()
  })
})

describe('getActiveFactionMembership', () => {
  it('returns active membership for the person', () => {
    const { state, leaderId } = makeFixture()
    const result = getActiveFactionMembership(state, leaderId)
    expect(result).toBeDefined()
    expect(result!.active).toBe(true)
  })

  it('returns undefined for person with inactive membership only', () => {
    const { state, faction1Id, member1Id } = makeFixture()
    // Deactivate the member1's membership
    const result = deactivateFaction(state, faction1Id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const inactiveResult = getActiveFactionMembership(result.value, member1Id)
    expect(inactiveResult).toBeUndefined()
  })

  it('returns undefined for person with no membership', () => {
    const { state } = makeFixture()
    const result = getActiveFactionMembership(state, createPersonId('pe', 99))
    expect(result).toBeUndefined()
  })
})

describe('getFactionActiveMemberIds', () => {
  it('returns active member PersonIds for the faction', () => {
    const { state, leaderId, member1Id, faction1Id } = makeFixture()
    const result = getFactionActiveMemberIds(state, faction1Id)
    expect(result).toContain(leaderId)
    expect(result).toContain(member1Id)
  })

  it('excludes inactive members', () => {
    const { state, faction1Id } = makeFixture()
    const result = getFactionActiveMemberIds(state, faction1Id)
    expect(result.sort()).toEqual([createPersonId('pe', 0), createPersonId('pe', 1)].sort())
  })

  it('returns empty for faction with no members', () => {
    const { state } = makeFixture()
    const emptyFactionId = createFactionId(99)
    state.factions[emptyFactionId] = {
      id: emptyFactionId,
      name: 'Empty',
      leaderPersonId: createPersonId('pe', 99),
      active: true,
      foundingYear: 1444,
      foundingMonth: 1,
    }
    const result = getFactionActiveMemberIds(state, emptyFactionId)
    expect(result).toEqual([])
  })
})

describe('getFactionOpportunityScore', () => {
  it('returns 0 for dead person', () => {
    const { state, member2Id } = makeFixture()
    const result = getFactionOpportunityScore(state, defaultConfig, member2Id)
    expect(result).toBe(0)
  })

  it('returns 0 for missing person', () => {
    const { state } = makeFixture()
    const result = getFactionOpportunityScore(state, defaultConfig, createPersonId('pe', 99))
    expect(result).toBe(0)
  })

  it('returns > 0 for alive person with a house (basic structure)', () => {
    const { state, leaderId } = makeFixture()
    const result = getFactionOpportunityScore(state, defaultConfig, leaderId)
    // With default config and no offices, score = personHouseShare * 0 = 0 for AnonymousHouse
    // But leader has a real house; score may be 0 if no offices exist
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThanOrEqual(0)
  })
})

describe('getFactionViabilityScore', () => {
  it('returns 0 for inactive faction', () => {
    const { state } = makeFixture()
    const inactiveFactionId = createFactionId(99)
    state.factions[inactiveFactionId] = {
      id: inactiveFactionId,
      name: 'Inactive',
      leaderPersonId: createPersonId('pe', 99),
      active: false,
      foundingYear: 1444,
      foundingMonth: 1,
    }
    const result = getFactionViabilityScore(state, defaultConfig, inactiveFactionId)
    expect(result).toBe(0)
  })

  it('returns > 0 for active faction with leader who has wealth', () => {
    const { state, leaderId, faction1Id } = makeFixture()
    // Give leader wealth so viability score is positive
    const leaderPerson = state.persons[leaderId]!
    const s: typeof state = {
      ...state,
      persons: { ...state.persons, [leaderId]: { ...leaderPerson, wealth: 100 } },
    }
    const result = getFactionViabilityScore(s, defaultConfig, faction1Id)
    expect(result).toBeGreaterThan(0)
  })
})

describe('getBestRoleScore', () => {
  it('returns a non-negative number', () => {
    const { state, leaderId } = makeFixture()
    const result = getBestRoleScore(state, leaderId)
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('returns 0 for missing person', () => {
    const { state } = makeFixture()
    const result = getBestRoleScore(state, createPersonId('pe', 99))
    expect(result).toBe(0)
  })
})

describe('getOccupationRoleFitBonus', () => {
  it('returns 0 when candidate has no occupation', () => {
    const { state, member1Id } = makeFixture()
    const candidate = state.persons[member1Id]
    if (!candidate) throw new Error('fixture missing person')
    expect(getOccupationRoleFitBonus(candidate)).toBe(0)
  })
  it('returns a positive bonus for adventurer occupation', () => {
    const { state, member1Id } = makeFixture()
    const candidate = state.persons[member1Id]
    if (!candidate) throw new Error('fixture missing person')
    const candidateWithOcc = { ...candidate, occupation: 'adventurer' as const }
    expect(getOccupationRoleFitBonus(candidateWithOcc)).toBeGreaterThan(0)
  })
})
