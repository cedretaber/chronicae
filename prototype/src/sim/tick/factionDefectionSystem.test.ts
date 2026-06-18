import { describe, expect, it } from 'vitest'
import type { TickContext } from './context'
import type { PersonId, ProvinceId, ProjectId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runFactionDefectionSystem } from './factionDefectionSystem'
import {
  createHouseId,
  createPersonId,
  createFactionId,
  createFactionMembershipId,
  createOfficeAssignmentId,
  createProvinceId,
  createPolityId,
  createProjectId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Faction, FactionMembership } from '../types/faction'
import type { OfficeAssignment, OfficeRole } from '../types/office'
import type { Project } from '../types/project'
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
  rngSeed = 'faction-defection-test',
): TickContext {
  return {
    state,
    rng: createRng(rngSeed),
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

function buildBaseState(currentYear = 1500): {
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
  state = {
    ...state,
    currentYear,
    currentWeekOfYear: 1,
    absoluteWeek: currentYear * 48,
  }
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
): WorldState {
  const faction: Faction = {
    id: factionId,
    leaderPersonId,
    polityId: createPolityId('dp', 0),
    active: true,
    foundingWeek: state.currentYear * 48 + state.currentWeekOfYear - 1,
  }
  const newIndex: import('../types/faction').FactionIndex = {
    byLeader: { ...state.factionIndex.byLeader, [leaderPersonId]: [factionId] },
    byMember: { ...state.factionIndex.byMember },
    byPolity: { ...state.factionIndex.byPolity, [createPolityId('dp', 0)]: [factionId] },
    byParent: { ...state.factionIndex.byParent },
  }
  return {
    ...state,
    factions: { ...state.factions, [factionId]: faction },
    factionIndex: newIndex,
  }
}

function addMembership(
  state: WorldState,
  membershipId: import('../types/ids').FactionMembershipId,
  factionId: import('../types/ids').FactionId,
  personId: PersonId,
  joinedWeek: number,
  lastActiveWeek?: number,
): WorldState {
  const membership: FactionMembership = {
    id: membershipId,
    factionId,
    personId,
    active: true,
    joinedWeek,
    lastActiveWeek: lastActiveWeek ?? joinedWeek,
  }
  const memberIds = state.factionIndex.byMember[personId] ?? []
  return {
    ...state,
    factionMemberships: { ...state.factionMemberships, [membershipId]: membership },
    factionIndex: {
      byLeader: { ...state.factionIndex.byLeader },
      byMember: { ...state.factionIndex.byMember, [personId]: [...memberIds, membershipId] },
      byPolity: { ...state.factionIndex.byPolity },
      byParent: { ...state.factionIndex.byParent },
    },
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
    slotIndex: 0,
    unpaidCount: 0,
  }
  const orgKey = `${organization.kind}:${organization.id}`
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
        [holderPersonId]: [...(state.officeIndex.byHolderPerson[holderPersonId] ?? []), officeId],
      },
    },
  }
}

function addActivePolityProject(
  state: WorldState,
  projectId: ProjectId,
  supervisorPersonId: PersonId,
  polityId: import('../types/ids').PolityId,
): WorldState {
  const project = {
    id: projectId,
    kind: 'develop_holding',
    status: 'active',
    owner: { kind: 'polity' as const, id: polityId },
    supervisorPersonId,
    creatorPersonId: supervisorPersonId,
    createdWeek: 0,
    budgetAllocated: 0,
    budgetSpent: 0,
    tasks: [],
  } as unknown as Project
  const existing = state.projectIndex.bySupervisorPerson[supervisorPersonId as string] ?? []
  return {
    ...state,
    projects: { ...state.projects, [projectId]: project },
    projectIndex: {
      ...state.projectIndex,
      bySupervisorPerson: {
        ...state.projectIndex.bySupervisorPerson,
        [supervisorPersonId as string]: [...existing, projectId],
      },
    },
  }
}

function addActivePersonProject(
  state: WorldState,
  projectId: ProjectId,
  supervisorPersonId: PersonId,
): WorldState {
  const project = {
    id: projectId,
    kind: 'personal_training',
    status: 'active',
    owner: { kind: 'person' as const, id: supervisorPersonId },
    supervisorPersonId,
    creatorPersonId: supervisorPersonId,
    createdWeek: 0,
    budgetAllocated: 0,
    budgetSpent: 0,
    tasks: [],
  } as unknown as Project
  const existing = state.projectIndex.bySupervisorPerson[supervisorPersonId as string] ?? []
  return {
    ...state,
    projects: { ...state.projects, [projectId]: project },
    projectIndex: {
      ...state.projectIndex,
      bySupervisorPerson: {
        ...state.projectIndex.bySupervisorPerson,
        [supervisorPersonId as string]: [...existing, projectId],
      },
    },
  }
}

describe('runFactionDefectionSystem', () => {
  it('returns identity when no active factions', () => {
    const { state } = buildBaseState()
    const ctx = makeCtx(state)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state).toBe(state)
  })

  it('leader is not subject to defection', () => {
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = addFaction(state, createFactionId(0), leaderId)
    const memberId = createPersonId('pe', 1)
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    // lastActiveWeek far in the past → idle long
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1480 * 48,
      1480 * 48,
    )

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factions[createFactionId(0)]?.leaderPersonId).toBe(leaderId)
    expect(result.state.factions[createFactionId(0)]?.active).toBe(true)
  })

  it('Office-holding member is exempt and lastActiveWeek is updated', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    const oldActiveWeek = 1480 * 48
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      oldActiveWeek,
      oldActiveWeek,
    )
    s = addOffice(s, createOfficeAssignmentId(0), memberId, 'administrator', {
      kind: 'house',
      id: houseId,
    })

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factionMemberships[createFactionMembershipId(0)]?.active).toBe(true)
    expect(result.state.factionMemberships[createFactionMembershipId(0)]?.lastActiveWeek).toBe(
      s.absoluteWeek,
    )
    expect(result.events).toHaveLength(0)
  })

  it('polity/house Project supervisor is exempt from defection', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId, polityId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    // No office, but has active polity project
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1480 * 48,
      1480 * 48,
    )
    s = addActivePolityProject(s, createProjectId(0), memberId, polityId)

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factionMemberships[createFactionMembershipId(0)]?.active).toBe(true)
    expect(result.state.factionMemberships[createFactionMembershipId(0)]?.lastActiveWeek).toBe(
      s.absoluteWeek,
    )
  })

  it('personal Project does NOT exempt from defection', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1480 * 48,
      1480 * 48,
    )
    s = addActivePersonProject(s, createProjectId(0), memberId)

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    // personal project は「仕事」扱いされないので離脱する
    expect(result.state.factionMemberships[createFactionMembershipId(0)]).toBeUndefined()
    expect(result.events.some((e) => e.type === 'FACTION_MEMBER_ABANDONED')).toBe(true)
  })

  it('idle < graceYears (lastActiveWeek basis): no defection', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    // lastActiveWeek = 20 weeks ago → idle < 1 year
    const recentActiveWeek = s.absoluteWeek - 20
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1480 * 48,
      recentActiveWeek,
    )

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factionMemberships[createFactionMembershipId(0)]?.active).toBe(true)
    expect(result.events.every((e) => e.type !== 'FACTION_MEMBER_ABANDONED')).toBe(true)
  })

  it('idle >= grace and roll < prob: defection happens, membership removed, event emitted', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, {
      nameKey: 'Member',
      houseId,
      alive: true,
      attitudes: { [`person:${leaderId}`]: { affection: 10, respect: 5 } },
    })
    s = addFaction(s, createFactionId(0), leaderId)
    // lastActiveWeek far in the past → idle >> grace
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1470 * 48,
      1470 * 48,
    )

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 1.0,
      factionDefectionAttitudeAffectionPenalty: 3,
      factionDefectionAttitudeRespectPenalty: 2,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factionMemberships[createFactionMembershipId(0)]).toBeUndefined()
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.type).toBe('FACTION_MEMBER_ABANDONED')
    expect(result.events[0]?.entityRefs.find((r) => r.kind === 'person')?.id).toBe(memberId)
    expect(result.events[0]?.entityRefs.filter((r) => r.kind === 'person')[1]?.id).toBe(leaderId)
    expect(result.state.persons[memberId]?.attitudes[`person:${leaderId}`]?.affection).toBe(10 - 3)
    expect(result.state.persons[memberId]?.attitudes[`person:${leaderId}`]?.respect).toBe(5 - 2)
  })

  it('idle >= grace and roll >= prob: no defection (probability fails)', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    // idle = 2 years, grace 1 → prob = (2-1)*0.001 = 0.001 → nearly zero
    const twoYearsAgo = s.absoluteWeek - 2 * 48
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1470 * 48,
      twoYearsAgo,
    )

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 0.001,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factionMemberships[createFactionMembershipId(0)]?.active).toBe(true)
    expect(result.events).toHaveLength(0)
  })

  it('after defection, factionIndex.byMember is synced (no stale id)', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    s = addMembership(s, createFactionMembershipId(0), createFactionId(0), memberId, 1470 * 48)

    const config = makeConfig({
      factionDefectionGraceYears: 1,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factionIndex.byMember[memberId]).toEqual([])
  })
})
