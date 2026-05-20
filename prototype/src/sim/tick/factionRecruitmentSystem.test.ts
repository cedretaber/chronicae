import { describe, expect, it } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runFactionRecruitmentSystem } from './factionRecruitmentSystem'
import {
  createHouseId,
  createPersonId,
  createFactionId,
  createFactionMembershipId,
  createProvinceId,
  createPolityId,
  createOfficeAssignmentId,
} from '../types/ids'
import type { PersonId, ProvinceId, PolityId, HouseId } from '../types/ids'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Faction, FactionMembership } from '../types/faction'
import type { OfficeAssignment } from '../types/office'
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
    rng: createRng('faction-recruitment-test'),
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
  state = { ...state, currentYear: 1444, absoluteWeek: 75088, currentWeekOfYear: 1 }
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
    foundingWeek: 75088,
  }
  const membership: FactionMembership = {
    id: createFactionMembershipId(0),
    factionId,
    personId: leaderPersonId,
    active: true,
    joinedWeek: 75088,
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

describe('runFactionRecruitmentSystem', () => {
  it('returns identity when currentWeekOfYear != 1', () => {
    const { state } = buildBaseState()
    const week12State: WorldState = { ...state, currentWeekOfYear: 12 }
    const ctx = makeCtx(week12State)
    const result = runFactionRecruitmentSystem(ctx)

    expect(result.state).toBe(week12State)
  })

  it('no active factions → identity', () => {
    const { state } = buildBaseState()
    const ctx = makeCtx(state)
    const result = runFactionRecruitmentSystem(ctx)

    expect(result.state).toBe(state)
  })

  it('active faction + leader with sufficient wealth + 1 candidate → candidate added to faction', () => {
    const { state, leaderId } = buildBaseState()
    const factionId = createFactionId(0)

    // Unaffiliated candidate (in AnonymousHouse)
    const candidateId = createPersonId('pe', 1)
    let s = state
    s = withPerson(s, candidateId, {
      name: 'Candidate',
      houseId: 'h-anon' as import('../types/ids').HouseId,
      wealth: 50,
      alive: true,
      age: 25,
      legacyPrestige: 10,
    })

    // Add faction
    const { state: s2 } = addFaction(s, factionId, leaderId)

    const ctx = makeCtx(s2)
    const result = runFactionRecruitmentSystem(ctx)

    // Candidate should be recruited
    const membership = result.state.factionIndex.byMember[candidateId]
    expect(membership).toBeDefined()
    expect(membership!.length).toBeGreaterThan(0)

    // Leader wealth should decrease
    const leaderPerson = result.state.persons[leaderId]!
    expect(leaderPerson.wealth).toBeLessThan(1000)

    // Candidate wealth should increase (signing bonus)
    const candidatePerson = result.state.persons[candidateId]!
    expect(candidatePerson.wealth).toBeGreaterThan(50)

    // Attitude keys should be created both directions
    const leaderToCandKey = `person:${candidateId}`
    const candToLeaderKey = `person:${leaderId}`
    expect(leaderPerson.attitudes[leaderToCandKey]).toBeDefined()
    expect(candidatePerson.attitudes[candToLeaderKey]).toBeDefined()

    // PERSON_RECRUITED_TO_FACTION event should be emitted
    const recruitedEvents = result.events.filter((e) => e.type === 'PERSON_RECRUITED_TO_FACTION')
    expect(recruitedEvents.length).toBeGreaterThan(0)
  })

  it('leader.wealth too low for cost → no recruitment', () => {
    const { state, leaderId } = buildBaseState()
    const factionId = createFactionId(0)

    const candidateId = createPersonId('pe', 1)
    let s = state
    s = withPerson(s, candidateId, {
      name: 'Candidate',
      houseId: 'h-anon' as import('../types/ids').HouseId,
      wealth: 50,
      alive: true,
      age: 25,
      legacyPrestige: 10,
    })

    // Make leader very poor
    const leaderPerson = s.persons[leaderId]!
    s = {
      ...s,
      persons: { ...s.persons, [leaderId]: { ...leaderPerson, wealth: 1 } },
    }

    const { state: s2 } = addFaction(s, factionId, leaderId)

    const ctx = makeCtx(s2)
    const result = runFactionRecruitmentSystem(ctx)

    // Candidate should NOT be recruited
    const membership = result.state.factionIndex.byMember[candidateId]
    expect(membership).toBeUndefined()

    // Leader wealth should be unchanged
    expect(result.state.persons[leaderId]?.wealth).toBe(1)
  })

  it('candidate already in another faction → skipped', () => {
    const { state, leaderId } = buildBaseState()
    const factionId = createFactionId(0)

    const candidateId = createPersonId('pe', 1)
    let s = state
    s = withPerson(s, candidateId, {
      name: 'Candidate',
      houseId: 'h-anon' as import('../types/ids').HouseId,
      wealth: 50,
      alive: true,
      age: 25,
      legacyPrestige: 10,
    })

    const { state: s2 } = addFaction(s, factionId, leaderId)

    // Add candidate to another faction
    const otherFactionId = createFactionId(1)
    const otherFaction: Faction = {
      id: otherFactionId,
      name: 'OtherFaction',
      leaderPersonId: candidateId,
      active: true,
      foundingWeek: 75088,
    }
    const otherMembership: FactionMembership = {
      id: createFactionMembershipId(1),
      factionId: otherFactionId,
      personId: candidateId,
      active: true,
      joinedWeek: 75088,
    }
    const s3: WorldState = {
      ...s2,
      factions: { ...s2.factions, [otherFactionId]: otherFaction },
      factionMemberships: {
        ...s2.factionMemberships,
        [createFactionMembershipId(1)]: otherMembership,
      },
      factionIndex: {
        ...s2.factionIndex,
        byLeader: { ...s2.factionIndex.byLeader, [candidateId]: [otherFactionId] },
        byMember: { ...s2.factionIndex.byMember, [candidateId]: [createFactionMembershipId(1)] },
      },
    }

    const ctx = makeCtx(s3)
    const result = runFactionRecruitmentSystem(ctx)

    // Candidate should NOT be recruited to the first faction
    const existingMembership = result.state.factionIndex.byMember[candidateId]
    // Should still only have the original membership
    expect(existingMembership?.length).toBe(1)
  })

  it('candidate already holds an active office → skipped', () => {
    const { state, leaderId } = buildBaseState()
    const factionId = createFactionId(0)

    const candidateId = createPersonId('pe', 1)
    let s = state
    s = withPerson(s, candidateId, {
      name: 'Candidate',
      houseId: 'h-anon' as import('../types/ids').HouseId,
      wealth: 50,
      alive: true,
      age: 25,
      legacyPrestige: 10,
    })

    const { state: s2 } = addFaction(s, factionId, leaderId)

    // Give candidate an active office
    const officeId = createOfficeAssignmentId(0)
    const office: OfficeAssignment = {
      id: officeId,
      organization: { kind: 'polity', id: createPolityId('dp', 0) },
      role: 'administrator',
      holderPersonId: candidateId,
      active: true,
      startYear: 1444,
      unpaidCount: 0,
    }
    const s3: WorldState = {
      ...s2,
      officeAssignments: { ...s2.officeAssignments, [officeId]: office },
      officeIndex: {
        ...s2.officeIndex,
        byOrganization: {
          ...s2.officeIndex.byOrganization,
          [`polity:${createPolityId('dp', 0)}`]: [officeId],
        },
        byHolderPerson: {
          ...s2.officeIndex.byHolderPerson,
          [candidateId]: [officeId],
        },
      },
    }

    const ctx = makeCtx(s3)
    const result = runFactionRecruitmentSystem(ctx)

    // Candidate should NOT be recruited (has active office)
    const membership = result.state.factionIndex.byMember[candidateId]
    expect(membership).toBeUndefined()
  })
})
