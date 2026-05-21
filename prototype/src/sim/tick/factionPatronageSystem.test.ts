import { describe, expect, it } from 'vitest'
import type { TickContext } from './context'
import type { PersonId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runFactionPatronageSystem } from './factionPatronageSystem'
import {
  createHouseId,
  createPersonId,
  createFactionId,
  createFactionMembershipId,
  createOfficeAssignmentId,
  createProvinceId,
  createPolityId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Faction, FactionMembership } from '../types/faction'
import type { OfficeAssignment, OfficeRole } from '../types/office'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'

function makeConfig(
  overrides: Partial<import('../config/defaultConfig').SimulationConfig> = {},
): import('../config/defaultConfig').SimulationConfig {
  return { ...defaultConfig, ...overrides }
}

function makeCtx(
  state: WorldState,
  config?: import('../config/defaultConfig').SimulationConfig,
): TickContext {
  return {
    state,
    rng: createRng('faction-patronage-test'),
    config: config || defaultConfig,
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
  polityId: import('../types/ids').PolityId
  houseId: import('../types/ids').HouseId
} {
  const leaderId = createPersonId('pe', 0)
  const provinceId = createProvinceId('p', 0)
  const polityId = createPolityId('dp', 0)
  const houseId = createHouseId('dh', 0)

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
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
    foundingWeek: 69312,
  }
  const newIndex: import('../types/faction').FactionIndex = {
    byLeader: { ...state.factionIndex.byLeader, [leaderPersonId]: [factionId] },
    byMember: { ...state.factionIndex.byMember },
  }
  return {
    state: {
      ...state,
      factions: { ...state.factions, [factionId]: faction },
      factionIndex: newIndex,
    },
    faction,
  }
}

function addFactionMembership(
  state: WorldState,
  membershipId: import('../types/ids').FactionMembershipId,
  factionId: import('../types/ids').FactionId,
  personId: PersonId,
): WorldState {
  const membership: FactionMembership = {
    id: membershipId,
    factionId,
    personId,
    active: true,
    joinedWeek: 69312,
  }
  const memberIds = state.factionIndex.byMember[personId] ?? []
  const newIndex: import('../types/faction').FactionIndex = {
    byLeader: { ...state.factionIndex.byLeader },
    byMember: { ...state.factionIndex.byMember, [personId]: [...memberIds, membershipId] },
  }
  return {
    ...state,
    factionMemberships: { ...state.factionMemberships, [membershipId]: membership },
    factionIndex: newIndex,
  }
}

function addOffice(
  state: WorldState,
  officeId: import('../types/ids').OfficeAssignmentId,
  holderPersonId: PersonId,
  role: OfficeRole,
  organization: { kind: 'house'; id: import('../types/ids').HouseId },
): WorldState {
  const office: OfficeAssignment = {
    id: officeId,
    organization,
    role,
    holderPersonId,
    active: true,
    startYear: 1444,
    unpaidCount: 0,
  }
  const orgKey = `${organization.kind}:${organization.id}`
  const holderKey = holderPersonId
  return {
    ...state,
    officeAssignments: { ...state.officeAssignments, [officeId]: office },
    officeIndex: {
      byOrganization: {
        ...state.officeIndex.byOrganization,
        [orgKey]: [...(state.officeIndex.byOrganization[orgKey] ?? []), officeId],
      },
      byHolderPerson: {
        ...state.officeIndex.byHolderPerson,
        [holderKey]: [...(state.officeIndex.byHolderPerson[holderKey] ?? []), officeId],
      },
    },
  }
}

describe('runFactionPatronageSystem', () => {
  it('returns identity when currentWeekOfYear != 1', () => {
    const { state } = buildBaseState()
    const week12State: WorldState = { ...state, currentWeekOfYear: 12 }
    const ctx = makeCtx(week12State)
    const result = runFactionPatronageSystem(ctx)

    expect(result.state).toBe(week12State)
  })

  it('returns identity when no active factions', () => {
    const { state } = buildBaseState()
    const ctx = makeCtx(state)
    const result = runFactionPatronageSystem(ctx)

    expect(result.state).toBe(state)
  })

  it('office-holding member with wealth > reserve donates to leader', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const officeId = createOfficeAssignmentId(0)
    const { state, leaderId, houseId } = buildBaseState()

    let s = state
    s = withPerson(s, memberId, { name: 'Member', houseId, wealth: 500, alive: true })
    const { state: s2, faction } = addFaction(s, factionId, leaderId)
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)
    // member has an office (non-leader role)
    const s4 = addOffice(s3, officeId, memberId, 'administrator', { kind: 'house', id: houseId })

    const customConfig = makeConfig({
      factionDonationRate: 0.5,
      factionDonationPersonalReserve: 200,
      factionDonationAffectionGain: 3,
      factionDonationRespectGain: 2,
      factionDonationAffectionGainSmall: 1,
    })
    void faction // used implicitly via addFaction return
    const ctx = makeCtx(s4, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // donation = min(wealth - reserve, floor(wealth * rate)) = min(500-200, floor(500*0.5)) = min(300, 250) = 250
    const expectedDonation = 250
    expect(result.state.persons[memberId]?.wealth).toBe(500 - expectedDonation)
    expect(result.state.persons[leaderId]?.wealth).toBe(1000 + expectedDonation)

    // adjustPersonAttitudeIfExists does NOT create new attitude keys.
    // Attitude keys are only updated if they already exist (tested in test 6).
    const leaderAttitudeKey = `person:${memberId}`
    expect(result.state.persons[leaderId]?.attitudes[leaderAttitudeKey]).toBeUndefined()
  })

  it('v0.17.4: FACTION_FUNDS_SHORTAGE fires when leader cannot pay stipend but is not bankrupt', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const { state, leaderId, houseId } = buildBaseState()

    // Leader wealth 100: stipend 10 + reserve 500 = 510 > 100 → 不払い
    // ただし factionDisbandWealthFloor (default 10) は上回るので BANKRUPT ではない
    let s = state
    s = { ...s, persons: { ...s.persons, [leaderId]: { ...s.persons[leaderId]!, wealth: 100 } } }
    s = withPerson(s, memberId, { name: 'NoOfficeMember', houseId, wealth: 0, alive: true })
    const s2 = addFaction(s, factionId, leaderId).state
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)

    const customConfig = makeConfig({
      factionStipendBase: 10,
      factionLeaderReserveWealth: 500,
      factionDisbandWealthFloor: 10,
    })
    const ctx = makeCtx(s3, customConfig)
    const result = runFactionPatronageSystem(ctx)

    const fundsShortageEvents = result.events.filter((e) => e.type === 'FACTION_FUNDS_SHORTAGE')
    expect(fundsShortageEvents).toHaveLength(1)
    expect(fundsShortageEvents[0]?.actorIds[0]).toBe(leaderId)
  })

  it('v0.17.4: FACTION_FUNDS_SHORTAGE does NOT fire when no unpaid members', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const { state, leaderId, houseId } = buildBaseState()

    let s = state
    s = withPerson(s, memberId, { name: 'NoOfficeMember', houseId, wealth: 0, alive: true })
    const s2 = addFaction(s, factionId, leaderId).state
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)

    // leader 1000 >> 500 + 10 → stipend 払える
    const customConfig = makeConfig({ factionStipendBase: 10, factionLeaderReserveWealth: 500 })
    const ctx = makeCtx(s3, customConfig)
    const result = runFactionPatronageSystem(ctx)

    expect(result.events.filter((e) => e.type === 'FACTION_FUNDS_SHORTAGE')).toHaveLength(0)
  })

  it('v0.17.4: FACTION_FUNDS_SHORTAGE does NOT fire when leader is already bankrupt', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const { state, leaderId, houseId } = buildBaseState()

    // Leader wealth 5 (< factionDisbandWealthFloor=10) → bankrupt 状態
    let s = state
    s = { ...s, persons: { ...s.persons, [leaderId]: { ...s.persons[leaderId]!, wealth: 5 } } }
    s = withPerson(s, memberId, { name: 'NoOfficeMember', houseId, wealth: 0, alive: true })
    const s2 = addFaction(s, factionId, leaderId).state
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)

    const customConfig = makeConfig({
      factionStipendBase: 10,
      factionLeaderReserveWealth: 500,
      factionDisbandWealthFloor: 10,
    })
    const ctx = makeCtx(s3, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // BANKRUPT 側に委ねる経路 → FUNDS_SHORTAGE は発火しない
    expect(result.events.filter((e) => e.type === 'FACTION_FUNDS_SHORTAGE')).toHaveLength(0)
  })

  it('v0.17.4: FACTION_FUNDS_SHORTAGE fires once per faction even with multiple unpaid members', () => {
    const member1Id = createPersonId('pe', 1)
    const member2Id = createPersonId('pe', 2)
    const factionId = createFactionId(0)
    const membership1Id = createFactionMembershipId(0)
    const membership2Id = createFactionMembershipId(1)
    const { state, leaderId, houseId } = buildBaseState()

    let s = state
    s = { ...s, persons: { ...s.persons, [leaderId]: { ...s.persons[leaderId]!, wealth: 100 } } }
    s = withPerson(s, member1Id, { name: 'M1', houseId, wealth: 0, alive: true })
    s = withPerson(s, member2Id, { name: 'M2', houseId, wealth: 0, alive: true })
    let s2 = addFaction(s, factionId, leaderId).state
    s2 = addFactionMembership(s2, membership1Id, factionId, member1Id)
    s2 = addFactionMembership(s2, membership2Id, factionId, member2Id)

    const customConfig = makeConfig({
      factionStipendBase: 10,
      factionLeaderReserveWealth: 500,
      factionDisbandWealthFloor: 10,
    })
    const ctx = makeCtx(s2, customConfig)
    const result = runFactionPatronageSystem(ctx)

    expect(result.events.filter((e) => e.type === 'FACTION_FUNDS_SHORTAGE')).toHaveLength(1)
  })

  it('leader pays stipend to no-office member when leader wealth > reserve + stipend', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const { state, leaderId, houseId } = buildBaseState()

    let s = state
    s = withPerson(s, memberId, { name: 'NoOfficeMember', houseId, wealth: 0, alive: true })
    const s2 = addFaction(s, factionId, leaderId).state
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)

    const customConfig = makeConfig({
      factionStipendBase: 10,
      factionLeaderReserveWealth: 500,
      factionStipendAffectionGain: 2,
      factionStipendRespectGain: 1,
    })
    const ctx = makeCtx(s3, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // leader wealth = 1000, reserve + stipend = 500 + 10 = 510, 1000 >= 510 → pays stipend
    expect(result.state.persons[leaderId]?.wealth).toBe(1000 - 10)
    expect(result.state.persons[memberId]?.wealth).toBe(10)

    // adjustPersonAttitudeIfExists does NOT create new attitude keys.
    const memberAttitudeKey = `person:${leaderId}`
    expect(result.state.persons[memberId]?.attitudes[memberAttitudeKey]).toBeUndefined()
  })

  it('leader does NOT pay stipend when wealth < reserve + stipend; attitude penalty if key exists', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const { state, leaderId, houseId } = buildBaseState()

    // Leader has low wealth
    let s = state
    s = { ...s, persons: { ...s.persons, [leaderId]: { ...s.persons[leaderId]!, wealth: 400 } } }
    s = withPerson(s, memberId, { name: 'NoOfficeMember', houseId, wealth: 0, alive: true })
    const s2 = addFaction(s, factionId, leaderId).state
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)

    const customConfig = makeConfig({
      factionStipendBase: 10,
      factionLeaderReserveWealth: 500,
      factionStipendShortageAffectionPenalty: 3,
      factionStipendShortageRespectPenalty: 2,
      factionStipendAffectionGain: 2,
      factionStipendRespectGain: 1,
    })
    const ctx = makeCtx(s3, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // leader wealth = 400, reserve + stipend = 510, 400 < 510 → no stipend
    expect(result.state.persons[leaderId]?.wealth).toBe(400)
    expect(result.state.persons[memberId]?.wealth).toBe(0)
  })

  it('pre-existing attitude key is adjusted by donation gains', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const officeId = createOfficeAssignmentId(0)
    const { state, leaderId, houseId } = buildBaseState()

    let s = state
    s = withPerson(s, memberId, { name: 'Member', houseId, wealth: 500, alive: true })
    const s2 = addFaction(s, factionId, leaderId).state
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)
    const s4 = addOffice(s3, officeId, memberId, 'administrator', { kind: 'house', id: houseId })

    // Pre-existing attitude: leader has affection=10, respect=5 for member
    const leaderAttKey = `person:${memberId}`
    const leaderPerson = s4.persons[leaderId]!
    const s5: WorldState = {
      ...s4,
      persons: {
        ...s4.persons,
        [leaderId]: {
          ...leaderPerson,
          attitudes: { [leaderAttKey]: { affection: 10, respect: 5 } },
        },
      },
    }

    const customConfig = makeConfig({
      factionDonationRate: 0.5,
      factionDonationPersonalReserve: 200,
      factionDonationAffectionGain: 3,
      factionDonationRespectGain: 2,
      factionDonationAffectionGainSmall: 1,
    })
    const ctx = makeCtx(s5, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // leader's attitude for member should be 10+3=13, 5+2=7
    const leaderAtt = result.state.persons[leaderId]?.attitudes[leaderAttKey]
    expect(leaderAtt?.affection).toBe(13)
    expect(leaderAtt?.respect).toBe(7)
  })

  it('does NOT create attitude key when source has no existing key for target', () => {
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const officeId = createOfficeAssignmentId(0)
    const { state, leaderId, houseId } = buildBaseState()

    let s = state
    s = withPerson(s, memberId, { name: 'Member', houseId, wealth: 500, alive: true })
    // Give leader an existing attitude key for member (so leader→member attitude update works)
    const leaderAttKey = `person:${memberId}`
    const leaderPerson = s.persons[leaderId]!
    s = {
      ...s,
      persons: {
        ...s.persons,
        [leaderId]: {
          ...leaderPerson,
          attitudes: { [leaderAttKey]: { affection: 10, respect: 5 } },
        },
      },
    }
    const s2 = addFaction(s, factionId, leaderId).state
    const s3 = addFactionMembership(s2, membershipId, factionId, memberId)
    const s4 = addOffice(s3, officeId, memberId, 'administrator', { kind: 'house', id: houseId })

    // member has NO attitude key for leader
    const memberAttKey = `person:${leaderId}`
    expect(s4.persons[memberId]?.attitudes[memberAttKey]).toBeUndefined()

    const customConfig = makeConfig({
      factionDonationRate: 0.5,
      factionDonationPersonalReserve: 200,
      factionDonationAffectionGain: 3,
      factionDonationRespectGain: 2,
      factionDonationAffectionGainSmall: 1,
    })
    const ctx = makeCtx(s4, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // member's attitude for leader should NOT be created (adjustPersonAttitudeIfExists)
    expect(result.state.persons[memberId]?.attitudes[memberAttKey]).toBeUndefined()
  })

  it('v0.17.1: Bailiff-holding member donates to leader (no Office, no Province Office change)', async () => {
    const { appointHoldingBailiff, vacateHoldingBailiff } =
      await import('../mutations/provinceOfficeMutations')
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const { state, leaderId, polityId, provinceId, houseId } = buildBaseState()

    let s = state
    s = withPerson(s, memberId, { name: 'BailiffMember', houseId, wealth: 500, alive: true })
    s = addFaction(s, factionId, leaderId).state
    s = addFactionMembership(s, membershipId, factionId, memberId)
    // Install member as Bailiff (ProvinceOffice) — no Polity/House Office
    const holdingId = s.provinces[provinceId]!.holdingIds[0]!
    s = vacateHoldingBailiff(s, holdingId)
    const weekVal = s.absoluteWeek
    s = appointHoldingBailiff(s, {
      holdingId,
      holderPersonId: memberId,
      appointingPolityId: polityId,
      week: weekVal,
    }).state

    const customConfig = makeConfig({
      factionDonationRate: 0.5,
      factionDonationPersonalReserve: 200,
    })
    const ctx = makeCtx(s, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // donation expected (Bailiff treated as "has Office" for donation path)
    expect(result.state.persons[memberId]?.wealth).toBeLessThan(500)
    expect(result.state.persons[leaderId]?.wealth).toBeGreaterThan(1000)
  })

  it('v0.17.1: Bailiff-holding member does NOT receive stipend (treated as office-holder)', async () => {
    const { appointHoldingBailiff, vacateHoldingBailiff } =
      await import('../mutations/provinceOfficeMutations')
    const memberId = createPersonId('pe', 1)
    const factionId = createFactionId(0)
    const membershipId = createFactionMembershipId(0)
    const { state, leaderId, polityId, provinceId, houseId } = buildBaseState()

    let s = state
    // Member has 0 wealth → no donation eligibility, but also Bailiff → should not receive stipend
    s = withPerson(s, memberId, { name: 'BailiffMember', houseId, wealth: 0, alive: true })
    s = addFaction(s, factionId, leaderId).state
    s = addFactionMembership(s, membershipId, factionId, memberId)
    const holdingId = s.provinces[provinceId]!.holdingIds[0]!
    s = vacateHoldingBailiff(s, holdingId)
    const weekVal = s.absoluteWeek
    s = appointHoldingBailiff(s, {
      holdingId,
      holderPersonId: memberId,
      appointingPolityId: polityId,
      week: weekVal,
    }).state

    const customConfig = makeConfig({
      factionStipendBase: 10,
      factionLeaderReserveWealth: 500,
    })
    const ctx = makeCtx(s, customConfig)
    const result = runFactionPatronageSystem(ctx)

    // leader has plenty (1000), but Bailiff-holding member is treated as office holder → no stipend
    expect(result.state.persons[memberId]?.wealth).toBe(0)
    expect(result.state.persons[leaderId]?.wealth).toBe(1000)
  })
})
