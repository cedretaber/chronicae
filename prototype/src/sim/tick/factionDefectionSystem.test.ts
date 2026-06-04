import { describe, expect, it } from 'vitest'
import type { TickContext } from './context'
import type { PersonId, ProvinceId } from '../types/ids'
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
): WorldState {
  const membership: FactionMembership = {
    id: membershipId,
    factionId,
    personId,
    active: true,
    joinedWeek,
  }
  const memberIds = state.factionIndex.byMember[personId] ?? []
  return {
    ...state,
    factionMemberships: { ...state.factionMemberships, [membershipId]: membership },
    factionIndex: {
      byLeader: { ...state.factionIndex.byLeader },
      byMember: { ...state.factionIndex.byMember, [personId]: [...memberIds, membershipId] },
      byPolity: { ...state.factionIndex.byPolity },
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

describe('runFactionDefectionSystem', () => {
  it('returns identity when currentWeekOfYear != 1', () => {
    const { state } = buildBaseState()
    const week30State: WorldState = { ...state, currentWeekOfYear: 30 }
    const ctx = makeCtx(week30State)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state).toBe(week30State)
  })

  it('returns identity when no active factions', () => {
    const { state } = buildBaseState()
    const ctx = makeCtx(state)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state).toBe(state)
  })

  it('leader is not subject to defection (idle calculation skipped for leader membership)', () => {
    // Leader 自身は対象外。membership として leader が登録されていない state (typical) なら影響なし。
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = addFaction(state, createFactionId(0), leaderId)
    // 別 member を追加 (Office なし、idle 長期) → defection は起きるが leader は無関係
    const memberId = createPersonId('pe', 1)
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1480 * 48 + 1 - 1,
    )

    const config = makeConfig({
      factionDefectionGraceYears: 8,
      factionDefectionProbPerYear: 1.0, // 必ず prob = max
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    // leader の faction.leaderPersonId は変わっていない
    expect(result.state.factions[createFactionId(0)]?.leaderPersonId).toBe(leaderId)
    expect(result.state.factions[createFactionId(0)]?.active).toBe(true)
  })

  it('Office-holding member is exempt from defection regardless of joinedYear', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    // joinedYear 1480 → idle 20 だが Office 持ちなので保護される
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1480 * 48 + 1 - 1,
    )
    s = addOffice(s, createOfficeAssignmentId(0), memberId, 'administrator', {
      kind: 'house',
      id: houseId,
    })

    const config = makeConfig({
      factionDefectionGraceYears: 8,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factionMemberships[createFactionMembershipId(0)]?.active).toBe(true)
    expect(result.events).toHaveLength(0)
  })

  it('idle < graceYears: no defection roll', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    // joinedWeek 77740 → idle = (78000-77740)/52 = 5 years (< grace 8 years)
    s = addMembership(s, createFactionMembershipId(0), createFactionId(0), memberId, 77740)

    const config = makeConfig({
      factionDefectionGraceYears: 8,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    expect(result.state.factions[createFactionId(0)]?.active).toBe(true)
    expect(result.events.every((e) => e.type !== 'FACTION_MEMBER_ABANDONED')).toBe(true)
  })

  it('idle >= grace and roll < prob: defection happens, membership removed, event emitted', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    // member の attitudes に leader への key を事前作成して penalty を確認できるようにする
    s = withPerson(s, memberId, {
      nameKey: 'Member',
      houseId,
      alive: true,
      attitudes: { [`person:${leaderId}`]: { affection: 10, respect: 5 } },
    })
    s = addFaction(s, createFactionId(0), leaderId)
    // idle = 30, grace 8 → prob = (30-8)*1.0 = max → 必ず離脱
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1470 * 48 + 1 - 1,
    )

    const config = makeConfig({
      factionDefectionGraceYears: 8,
      factionDefectionProbPerYear: 1.0,
      factionDefectionAttitudeAffectionPenalty: 3,
      factionDefectionAttitudeRespectPenalty: 2,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    // membership 完全削除 (v0.17.3 C)
    expect(result.state.factionMemberships[createFactionMembershipId(0)]).toBeUndefined()
    // event 発火
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.type).toBe('FACTION_MEMBER_ABANDONED')
    expect(result.events[0]?.entityRefs.find((r) => r.kind === 'person')?.id).toBe(memberId)
    expect(result.events[0]?.entityRefs.filter((r) => r.kind === 'person')[1]?.id).toBe(leaderId)
    // attitude penalty 適用
    expect(result.state.persons[memberId]?.attitudes[`person:${leaderId}`]?.affection).toBe(10 - 3)
    expect(result.state.persons[memberId]?.attitudes[`person:${leaderId}`]?.respect).toBe(5 - 2)
  })

  it('idle >= grace and roll >= prob: no defection (probability fails)', () => {
    const memberId = createPersonId('pe', 1)
    const { state, leaderId, houseId } = buildBaseState(1500)
    let s = state
    s = withPerson(s, memberId, { nameKey: 'Member', houseId, alive: true })
    s = addFaction(s, createFactionId(0), leaderId)
    // idle = 9, grace 8 → prob = (9-8)*0.001 = 0.001 → ほぼ確実に roll >= prob
    s = addMembership(
      s,
      createFactionMembershipId(0),
      createFactionId(0),
      memberId,
      1491 * 48 + 1 - 1,
    )

    const config = makeConfig({
      factionDefectionGraceYears: 8,
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
    s = addMembership(s, createFactionMembershipId(0), createFactionId(0), memberId, 1470)

    const config = makeConfig({
      factionDefectionGraceYears: 8,
      factionDefectionProbPerYear: 1.0,
    })
    const ctx = makeCtx(s, config)
    const result = runFactionDefectionSystem(ctx)

    // membership 完全削除されたので byMember[memberId] は空
    expect(result.state.factionIndex.byMember[memberId]).toEqual([])
  })
})
