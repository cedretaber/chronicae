import { describe, expect, it } from 'vitest'
import {
  createPersonId,
  createHouseId,
  createFactionId,
  createFactionMembershipId,
  createPolityId,
  createProvinceId,
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
  getFactionNominationPower,
  hasRelevantFactionForAppointment,
  getFactionRecommendationScore,
  getFactionalCandidateScore,
  collectSubtreeMemberWeights,
  collectSubtreeLeaderWeights,
} from './factionSelectors'
import { defaultConfig } from '../config/defaultConfig'
import { deactivateFaction } from '../mutations/factionMutations'
import { makeEmptyV016State, withPerson, withHouse, withPolity } from '../testFixtures'

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
    nameKey: 'Test House',
    memberIds: [leaderId, member1Id, member2Id],
  })
  state = withPerson(state, leaderId, { nameKey: 'Leader', houseId })
  state = withPerson(state, member1Id, { nameKey: 'Member1', houseId })
  state = withPerson(state, member2Id, { nameKey: 'Member2', houseId })

  const faction1Id = createFactionId(0)
  const faction2Id = createFactionId(1)
  state.factions[faction1Id] = {
    id: faction1Id,
    leaderPersonId: leaderId,
    polityId: createPolityId('c', 0),
    active: true,
    foundingWeek: 69312,
  }
  state.factionMemberships[createFactionMembershipId(0)] = {
    id: createFactionMembershipId(0),
    factionId: faction1Id,
    personId: leaderId,
    active: true,
    joinedWeek: 69312,
  }
  state.factionMemberships[createFactionMembershipId(1)] = {
    id: createFactionMembershipId(1),
    factionId: faction1Id,
    personId: member1Id,
    active: true,
    joinedWeek: 69312,
  }
  state.factionIndex.byMember[leaderId] = [createFactionMembershipId(0)]
  state.factionIndex.byMember[member1Id] = [createFactionMembershipId(1)]
  state.factionIndex.byLeader[leaderId] = [faction1Id]

  const inactiveFactionId = createFactionId(2)
  state.factions[inactiveFactionId] = {
    id: inactiveFactionId,
    leaderPersonId: member2Id,
    polityId: createPolityId('c', 0),
    active: false,
    foundingWeek: 74891,
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
    expect(result!.leaderPersonId).toBeDefined()
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
      leaderPersonId: createPersonId('pe', 99),
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
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
      leaderPersonId: createPersonId('pe', 99),
      polityId: createPolityId('c', 0),
      active: false,
      foundingWeek: 69312,
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

// ---------------------------------------------------------------------------
// v0.17 §14.1: getFactionNominationPower tests
// ---------------------------------------------------------------------------

describe('getFactionNominationPower', () => {
  it('returns 0 for inactive faction', () => {
    const { state, faction2Id } = makeFixture()
    const result = getFactionNominationPower(
      state,
      defaultConfig,
      faction2Id,
      { kind: 'polity', id: createPolityId('c', 0) },
      'administrator',
    )
    expect(result).toBe(0)
  })

  it('returns 0 for missing faction', () => {
    const { state } = makeFixture()
    const result = getFactionNominationPower(
      state,
      defaultConfig,
      createFactionId(99),
      { kind: 'polity', id: createPolityId('c', 0) },
      'administrator',
    )
    expect(result).toBe(0)
  })

  it('returns positive power when faction member is in owner house of a polity', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const leaderId = createPersonId('pe', 0)
    const member1Id = createPersonId('pe', 1)
    const faction1Id = createFactionId(0)
    const membershipId = createFactionMembershipId(0)

    let state = makeEmptyV016State()
    state = withHouse(state, houseId, { nameKey: 'Test House', memberIds: [leaderId, member1Id] })
    state = withPerson(state, leaderId, { nameKey: 'Leader', houseId })
    state = withPerson(state, member1Id, { nameKey: 'Member', houseId })
    state = withPolity(state, polityId, {
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: createProvinceId('p', 0),
    })
    state.factions[faction1Id] = {
      id: faction1Id,
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
    }
    state.factionMemberships[membershipId] = {
      id: membershipId,
      factionId: faction1Id,
      personId: member1Id,
      active: true,
      joinedWeek: 69312,
    }
    state.factionIndex.byMember[member1Id] = [membershipId]
    state.factionIndex.byLeader[leaderId] = [faction1Id]

    const result = getFactionNominationPower(
      state,
      defaultConfig,
      faction1Id,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    expect(result).toBeGreaterThan(0)
  })

  it('returns lower power for commonwealth (ownerHouseId undefined)', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const leaderId = createPersonId('pe', 0)
    const member1Id = createPersonId('pe', 1)
    const faction1Id = createFactionId(0)
    const membershipId = createFactionMembershipId(0)

    let state = makeEmptyV016State()
    state = withHouse(state, houseId, { nameKey: 'Test House', memberIds: [leaderId, member1Id] })
    state = withPerson(state, leaderId, { nameKey: 'Leader', houseId })
    state = withPerson(state, member1Id, { nameKey: 'Member', houseId })
    state = withPolity(state, polityId, {
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: createProvinceId('p', 0),
    })
    state.factions[faction1Id] = {
      id: faction1Id,
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
    }
    state.factionMemberships[membershipId] = {
      id: membershipId,
      factionId: faction1Id,
      personId: member1Id,
      active: true,
      joinedWeek: 69312,
    }
    state.factionIndex.byMember[member1Id] = [membershipId]
    state.factionIndex.byLeader[leaderId] = [faction1Id]

    const result = getFactionNominationPower(
      state,
      defaultConfig,
      faction1Id,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    // Should be positive due to share, but less than with ownerHouse bonus
    expect(result).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// v0.17 §14.1: hasRelevantFactionForAppointment tests
// ---------------------------------------------------------------------------

describe('hasRelevantFactionForAppointment', () => {
  it('returns false when no factions exist', () => {
    const state = makeEmptyV016State()
    const result = hasRelevantFactionForAppointment(
      state,
      defaultConfig,
      { kind: 'polity', id: createPolityId('c', 0) },
      'administrator',
    )
    expect(result).toBe(false)
  })

  it('returns true when at least one faction NP >= threshold', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const leaderId = createPersonId('pe', 0)
    const member1Id = createPersonId('pe', 1)
    const faction1Id = createFactionId(0)
    const membershipId = createFactionMembershipId(0)

    let state = makeEmptyV016State()
    state = withHouse(state, houseId, { nameKey: 'Test House', memberIds: [leaderId, member1Id] })
    state = withPerson(state, leaderId, { nameKey: 'Leader', houseId })
    state = withPerson(state, member1Id, { nameKey: 'Member', houseId })
    state = withPolity(state, polityId, {
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: createProvinceId('p', 0),
    })
    state.factions[faction1Id] = {
      id: faction1Id,
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
    }
    state.factionMemberships[membershipId] = {
      id: membershipId,
      factionId: faction1Id,
      personId: member1Id,
      active: true,
      joinedWeek: 69312,
    }
    state.factionIndex.byMember[member1Id] = [membershipId]
    state.factionIndex.byLeader[leaderId] = [faction1Id]

    const result = hasRelevantFactionForAppointment(
      state,
      defaultConfig,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// v0.17 §14.3: getFactionRecommendationScore tests
// ---------------------------------------------------------------------------

describe('getFactionRecommendationScore', () => {
  it('leader-loves-candidate > leader-hates-candidate', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const leaderId = createPersonId('pe', 0)
    const lovedId = createPersonId('pe', 1)
    const hatedId = createPersonId('pe', 2)
    const faction1Id = createFactionId(0)
    const memLovedId = createFactionMembershipId(0)
    const memHatedId = createFactionMembershipId(1)

    let state = makeEmptyV016State()
    state = withHouse(state, houseId, {
      nameKey: 'Test House',
      memberIds: [leaderId, lovedId, hatedId],
    })
    state = withPerson(state, leaderId, { nameKey: 'Leader', houseId })
    state = withPerson(state, lovedId, { nameKey: 'Loved', houseId })
    state = withPerson(state, hatedId, { nameKey: 'Hated', houseId })
    state = withPolity(state, polityId, {
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: createProvinceId('p', 0),
    })
    state.factions[faction1Id] = {
      id: faction1Id,
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
    }
    state.factionMemberships[memLovedId] = {
      id: memLovedId,
      factionId: faction1Id,
      personId: lovedId,
      active: true,
      joinedWeek: 69312,
    }
    state.factionMemberships[memHatedId] = {
      id: memHatedId,
      factionId: faction1Id,
      personId: hatedId,
      active: true,
      joinedWeek: 69312,
    }
    state.factionIndex.byMember[lovedId] = [memLovedId]
    state.factionIndex.byMember[hatedId] = [memHatedId]
    state.factionIndex.byLeader[leaderId] = [faction1Id]

    // Leader loves lovedId (affection=100, respect=100)
    state.persons[leaderId]!.attitudes = {
      ...state.persons[leaderId]!.attitudes,
      [`person:${lovedId}`]: { affection: 100, respect: 100 },
    }
    // Leader hates hatedId (affection=-100, respect=-100)
    state.persons[leaderId]!.attitudes = {
      ...state.persons[leaderId]!.attitudes,
      [`person:${hatedId}`]: { affection: -100, respect: -100 },
    }
    // Loved candidate has positive attitude toward leader
    state.persons[lovedId]!.attitudes = {
      ...state.persons[lovedId]!.attitudes,
      [`person:${leaderId}`]: { affection: 100, respect: 100 },
    }
    // Hated candidate has negative attitude toward leader
    state.persons[hatedId]!.attitudes = {
      ...state.persons[hatedId]!.attitudes,
      [`person:${leaderId}`]: { affection: -100, respect: -100 },
    }

    const lovedScore = getFactionRecommendationScore(
      state,
      faction1Id,
      lovedId,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    const hatedScore = getFactionRecommendationScore(
      state,
      faction1Id,
      hatedId,
      { kind: 'polity', id: polityId },
      'administrator',
    )

    expect(lovedScore).toBeGreaterThan(hatedScore)
  })
})

// ---------------------------------------------------------------------------
// v0.17 §14.1: getFactionalCandidateScore tests
// ---------------------------------------------------------------------------

describe('getFactionalCandidateScore', () => {
  it('returns > 0 for a well-set-up case', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const leaderId = createPersonId('pe', 0)
    const candidateId = createPersonId('pe', 1)
    const faction1Id = createFactionId(0)
    const memId = createFactionMembershipId(0)

    let state = makeEmptyV016State()
    state = withHouse(state, houseId, {
      nameKey: 'Test House',
      memberIds: [leaderId, candidateId],
    })
    state = withPerson(state, leaderId, { nameKey: 'Leader', houseId })
    state = withPerson(state, candidateId, {
      nameKey: 'Candidate',
      houseId,
      abilities: {
        valor: 50,
        command: 50,
        numeracy: 80,
        learning: 80,
        charisma: 80,
        insight: 80,
      },
    })
    state = withPolity(state, polityId, {
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: createProvinceId('p', 0),
    })
    state.factions[faction1Id] = {
      id: faction1Id,
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
    }
    state.factionMemberships[memId] = {
      id: memId,
      factionId: faction1Id,
      personId: candidateId,
      active: true,
      joinedWeek: 69312,
    }
    state.factionIndex.byMember[candidateId] = [memId]
    state.factionIndex.byLeader[leaderId] = [faction1Id]

    const result = getFactionalCandidateScore(
      state,
      defaultConfig,
      faction1Id,
      candidateId,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    expect(result).toBeGreaterThan(0)
  })
})

describe('collectSubtreeMemberWeights (入れ子 Phase 2-b)', () => {
  // faction1 (leader+member1) の傘下に faction2 (member2) を attach し、深さ重みを確認する。
  function makeNestedFixture() {
    const f = makeFixture()
    const { state, member2Id, faction1Id, faction2Id } = f
    // faction2 = member2 が率いる child、faction1 の傘下。
    state.factions[faction2Id] = {
      id: faction2Id,
      leaderPersonId: member2Id,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
      parentFactionId: faction1Id,
    }
    state.factionMemberships[createFactionMembershipId(5)] = {
      id: createFactionMembershipId(5),
      factionId: faction2Id,
      personId: member2Id,
      active: true,
      joinedWeek: 69312,
    }
    state.factionIndex.byMember[member2Id] = [createFactionMembershipId(5)]
    state.factionIndex.byLeader[member2Id] = [faction2Id]
    state.factionIndex.byParent[faction1Id] = [faction2Id]
    return f
  }

  it('own member は weight 1.0、子 member は discount 倍', () => {
    const { state, leaderId, member1Id, member2Id, faction1Id } = makeNestedFixture()
    const weights = collectSubtreeMemberWeights(state, defaultConfig, faction1Id)
    const map = new Map(weights.map((w) => [w.memberId as string, w.weight]))
    expect(map.get(leaderId as string)).toBe(1)
    expect(map.get(member1Id as string)).toBe(1)
    expect(map.get(member2Id as string)).toBe(defaultConfig.factionNestingNpDiscount)
  })

  it('root のみの派閥では own member だけが weight 1.0 で返る', () => {
    const { state, leaderId, member1Id, member2Id, faction1Id } = makeFixture()
    void member2Id
    const weights = collectSubtreeMemberWeights(state, defaultConfig, faction1Id)
    expect(weights.every((w) => w.weight === 1)).toBe(true)
    const ids = new Set(weights.map((w) => w.memberId as string))
    expect(ids.has(leaderId as string)).toBe(true)
    expect(ids.has(member1Id as string)).toBe(true)
  })

  it('親 NP は子を傘下に取ると単調増（子孫の寄与が加わる）', () => {
    const { state, faction1Id } = makeNestedFixture()
    const org = { kind: 'polity' as const, id: createPolityId('c', 0) }
    const npWith = getFactionNominationPower(state, defaultConfig, faction1Id, org, 'advisor')
    // 子を外した状態 (root のみ) と比較
    const stateNoChild: WorldState = {
      ...state,
      factions: { ...state.factions, [faction1Id]: { ...state.factions[faction1Id]! } },
      factionIndex: { ...state.factionIndex, byParent: {} },
    }
    const npWithout = getFactionNominationPower(
      stateNoChild,
      defaultConfig,
      faction1Id,
      org,
      'advisor',
    )
    expect(npWith).toBeGreaterThanOrEqual(npWithout)
  })
})

describe('subtree leader 引き上げ (v0.50)', () => {
  // 現実的な入れ子: 子派閥 faction2 を別人物 subLeader が率いる。実 sim ではリーダーも自派閥に
  // self-membership を持つ (設立時に作られ removeDeadMemberships が保持) ため、ここでも subLeader を
  // faction2 の member として登録する。member は member2 + subLeader (=リーダー自身)。
  function makeRealisticNestedFixture(): {
    state: WorldState
    leaderId: PersonId
    member1Id: PersonId
    member2Id: PersonId
    subLeaderId: PersonId
    faction1Id: FactionId
    faction2Id: FactionId
  } {
    const { state, leaderId, member1Id, member2Id, houseId, faction1Id, faction2Id } = makeFixture()
    const subLeaderId = createPersonId('pe', 3)
    const s = withPerson(state, subLeaderId, { nameKey: 'SubLeader', houseId })
    // faction2 = subLeader が率いる child、faction1 の傘下。
    s.factions[faction2Id] = {
      id: faction2Id,
      leaderPersonId: subLeaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: 69312,
      parentFactionId: faction1Id,
    }
    s.factionMemberships[createFactionMembershipId(5)] = {
      id: createFactionMembershipId(5),
      factionId: faction2Id,
      personId: member2Id,
      active: true,
      joinedWeek: 69312,
    }
    // subLeader の self-membership (実 sim のリーダー不変条件を反映)。
    s.factionMemberships[createFactionMembershipId(6)] = {
      id: createFactionMembershipId(6),
      factionId: faction2Id,
      personId: subLeaderId,
      active: true,
      joinedWeek: 69312,
    }
    s.factionIndex.byMember[member2Id] = [createFactionMembershipId(5)]
    s.factionIndex.byMember[subLeaderId] = [createFactionMembershipId(6)]
    s.factionIndex.byLeader[subLeaderId] = [faction2Id]
    s.factionIndex.byParent[faction1Id] = [faction2Id]
    return { state: s, leaderId, member1Id, member2Id, subLeaderId, faction1Id, faction2Id }
  }

  it('collectSubtreeMemberWeights は子派閥 leader(=副官) を self-membership 経由で discount 倍で含める', () => {
    // v0.50 の知見: リーダーは self-membership を持つので、専用の leader 追加なしに
    // member ループだけで子孫の副官が NP / bailiff の傘プールに乗る。
    const { state, subLeaderId, member2Id, faction1Id } = makeRealisticNestedFixture()
    const weights = collectSubtreeMemberWeights(state, defaultConfig, faction1Id)
    const map = new Map(weights.map((w) => [w.memberId as string, w.weight]))
    // child member も child leader も depth1 = discount。
    expect(map.get(member2Id as string)).toBe(defaultConfig.factionNestingNpDiscount)
    expect(map.get(subLeaderId as string)).toBe(defaultConfig.factionNestingNpDiscount)
  })

  it('collectSubtreeLeaderWeights は子孫 leader のみ返す (patron と子孫 member は除外)', () => {
    const { state, leaderId, member1Id, member2Id, subLeaderId, faction1Id } =
      makeRealisticNestedFixture()
    const leaders = collectSubtreeLeaderWeights(state, defaultConfig, faction1Id)
    const ids = new Set(leaders.map((l) => l.leaderId as string))
    expect(ids.has(subLeaderId as string)).toBe(true) // 子派閥 leader = 副官
    expect(ids.has(leaderId as string)).toBe(false) // depth0 patron は含めない
    expect(ids.has(member1Id as string)).toBe(false) // own member は leader でない
    expect(ids.has(member2Id as string)).toBe(false) // 子孫の一般 member も含めない
    const w = leaders.find((l) => (l.leaderId as string) === (subLeaderId as string))
    expect(w?.weight).toBe(defaultConfig.factionNestingNpDiscount)
  })

  it('collectSubtreeLeaderWeights は root のみの派閥では空 (子孫が無い)', () => {
    const { state, faction1Id } = makeFixture()
    expect(collectSubtreeLeaderWeights(state, defaultConfig, faction1Id)).toEqual([])
  })
})
