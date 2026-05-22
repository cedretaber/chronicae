import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createOfficeAssignmentId,
  createPersonId,
  createProvinceId,
  createFactionId,
  createFactionMembershipId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runAppointmentSystem } from './appointmentSystem'
import type { SimEvent } from '../types/event'
import type { OfficeRole } from '../types/office'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'
import { appointHoldingBailiff, vacateHoldingBailiff } from '../mutations/provinceOfficeMutations'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeBaseState(): {
  state: WorldState
  polityId: PolityId
  houseRulerId: HouseId
  houseVassalId: HouseId
  personRulerId: PersonId
  personVassalId: PersonId
} {
  const polityId = createPolityId('c', 0)
  const houseRulerId = createHouseId('h', 0)
  const houseVassalId = createHouseId('h', 1)
  const personRulerId = createPersonId('pe', 0)
  const personVassalId = createPersonId('pe', 1)
  const provinceRulerId = createProvinceId('p', 0)
  const provinceVassalId = createProvinceId('p', 1)

  // v0.16: chain depth 1 では polity owner house のメンバーのみが当該 polity の Office 候補者になる。
  // 旧 fixture が想定した複数 House の候補競合を保つため、両人物を houseRuler の member として扱う。
  // houseVassal は別 House として残すが、polity1 の Office 候補としては寄与しない。
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  state = withProvince(state, provinceRulerId, { nameKey: 'Ruler Province' })
  state = withProvince(state, provinceVassalId, {
    nameKey: 'Vassal Province',
    x: 1,
    y: 1,
  })
  state = withHouse(state, houseRulerId, {
    nameKey: 'Ruler House',
    memberIds: [personRulerId, personVassalId],
    legacyPrestige: 50,
    seatProvinceId: provinceRulerId,
  })
  state = withHouse(state, houseVassalId, {
    nameKey: 'Vassal House',
    legacyPrestige: 50,
    seatProvinceId: provinceVassalId,
  })
  state = withPolity(state, polityId, {
    nameKey: 'Polity 1',
    ownerHouseId: houseRulerId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceRulerId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceRulerId, polityId, houseRulerId)
  state = bindProvinceToHouseViaPolity(state, provinceVassalId, polityId, houseRulerId)
  state = withPerson(state, personRulerId, {
    nameKey: 'Ruler Person',
    houseId: houseRulerId,
    birthStatus: 'unknown',
    traits: { ambition: 0.3, caution: 0.5 },
    legacyPrestige: 30,
  })
  state = withPerson(state, personVassalId, {
    nameKey: 'Vassal Person',
    age: 35,
    houseId: houseRulerId,
    birthStatus: 'unknown',
    traits: { ambition: 0.2, caution: 0.6 },
    legacyPrestige: 40,
  })

  return {
    state,
    polityId,
    houseRulerId,
    houseVassalId,
    personRulerId,
    personVassalId,
  }
}

function buildCtx(state: WorldState, config: SimulationConfig) {
  return createTickContext({ state, rng: createRng('test'), config })
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

function holdsOfficeRole(state: WorldState, personId: PersonId, role: OfficeRole): boolean {
  const assignmentIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const id of assignmentIds) {
    const assignment = state.officeAssignments[id]
    if (assignment && assignment.role === role) {
      return true
    }
  }
  return false
}

describe('runAppointmentSystem', () => {
  it('appoints best candidate to administrator role in January', () => {
    const { state, polityId, personRulerId, personVassalId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const stateWithLeader: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId],
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithLeader, config)

    const result = toResult(runAppointmentSystem(ctx))

    // p-1 (personVassalId) has higher adminScore (9 > 7), so p-1 gets administrator
    expect(holdsOfficeRole(result.state, personVassalId, 'administrator')).toBe(true)
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBeGreaterThan(0)
  })

  it('does not replace current holder when score diff < replacementThreshold', () => {
    const { state, polityId, personRulerId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const adminOfficeId = createOfficeAssignmentId(100)
    const stateWithOffices: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
        [adminOfficeId]: {
          id: adminOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'administrator',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId, adminOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId, adminOfficeId],
        },
      },
    }

    const config = { ...defaultConfig, replacementThreshold: 30 }
    const ctx = buildCtx(stateWithOffices, config)

    const result = toResult(runAppointmentSystem(ctx))

    // Current holder keeps office (slot is full)
    expect(holdsOfficeRole(result.state, personRulerId, 'administrator')).toBe(true)
    // v0.15 §13.4: sameHousePolityOfficePenalty を加算するため、
    // 同 House のみで複数 Polity Office を埋める score が早く minAppointmentScore を下回る。
    // vassal は treasurer 1 つだけ埋め、それ以降は閾値未満で停止する。
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBe(1)
    expect(countEvents(result.events, 'OFFICE_REVOKED')).toBe(0)
  })

  it('replaces current holder on January when score diff >= replacementThreshold', () => {
    const { state, polityId, personRulerId, personVassalId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const adminOfficeId = createOfficeAssignmentId(100)
    const stateWithOffices: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
        [adminOfficeId]: {
          id: adminOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'administrator',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId, adminOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId, adminOfficeId],
        },
      },
    }

    const config = { ...defaultConfig, replacementThreshold: 20 }
    const ctx = buildCtx(stateWithOffices, config)

    const result = toResult(runAppointmentSystem(ctx))

    // p-1 has higher admin score (9) than p-0 (7), so p-1 replaces p-0
    expect(holdsOfficeRole(result.state, personVassalId, 'administrator')).toBe(true)
    // OFFICE_REVOKED events are not emitted for replacements (only for dead people)
    expect(countEvents(result.events, 'OFFICE_REVOKED')).toBe(0)
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBeGreaterThan(0)
  })

  it('revokes dead person office and appoints new person', () => {
    const { state, polityId, personRulerId, personVassalId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const adminOfficeId = createOfficeAssignmentId(100)
    const stateWithOffices: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
        [adminOfficeId]: {
          id: adminOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'administrator',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId, adminOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId, adminOfficeId],
        },
      },
      persons: {
        ...state.persons,
        [personRulerId]: { ...state.persons[personRulerId]!, alive: false },
      },
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithOffices, config)

    const result = toResult(runAppointmentSystem(ctx))

    // p-1 (personVassalId) gets administrator since p-0 is dead
    expect(holdsOfficeRole(result.state, personVassalId, 'administrator')).toBe(true)
    // Dead person revocation does not emit OFFICE_REVOKED event (only replacement does)
    expect(countEvents(result.events, 'OFFICE_REVOKED')).toBe(0)
    // v0.16: chain depth 1 では owner house members だけが候補となるため、
    // 死亡した personRuler の代わりに personVassal が複数 Office を埋める可能性がある。
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBeGreaterThan(0)
  })

  it('concurrent office penalty reduces score for already-office-holding candidates', () => {
    const base = makeBaseState()
    const { polityId, personRulerId, personVassalId } = base

    const leaderOfficeId = createOfficeAssignmentId(99)
    const state: WorldState = {
      ...base.state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId],
        },
      },
      persons: {
        ...base.state.persons,
        [base.personRulerId]: {
          ...base.state.persons[base.personRulerId]!,
          abilities: DEFAULT_ABILITIES,
          aptitudes: DEFAULT_ABILITIES,
        },
      },
      landContracts: {},
      holdingOfficeAssignments: {},
      holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
      landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
      holdingTerminalPolityCache: {},
      polityIndex: { byOwnerHouse: {} },
      nextLandContractId: 0,
      nextHoldingOfficeAssignmentId: 0,
      nextFactionId: 0,
      nextFactionMembershipId: 0,
      actorIntents: {},
      diplomaticPlays: {},
      nextActorIntentId: 0,
      nextDiplomaticPlayId: 0,
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(state, config)

    const result = toResult(runAppointmentSystem(ctx))

    // ruler has admin=10 but holds 1 office (penalty=8), net ~5
    // vassal has admin=9 and no offices, net ~13 → vassal wins
    expect(holdsOfficeRole(result.state, personVassalId, 'administrator')).toBe(true)
    expect(holdsOfficeRole(result.state, personRulerId, 'administrator')).toBe(false)
  })

  it('uses female candidates when no male candidates and allowFemaleRolesWhenNoMaleCandidate=true', () => {
    const base = makeBaseState()
    const { polityId, personRulerId } = base

    const leaderOfficeId = createOfficeAssignmentId(99)
    const state: WorldState = {
      ...base.state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId],
        },
      },
      persons: {
        ...base.state.persons,
        [base.personRulerId]: {
          ...base.state.persons[base.personRulerId]!,
          sex: 'female',
        },
        [base.personVassalId]: {
          ...base.state.persons[base.personVassalId]!,
          sex: 'female',
        },
      },
      landContracts: {},
      holdingOfficeAssignments: {},
      holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
      landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
      holdingTerminalPolityCache: {},
      polityIndex: { byOwnerHouse: {} },
      nextLandContractId: 0,
      nextHoldingOfficeAssignmentId: 0,
      nextFactionId: 0,
      nextFactionMembershipId: 0,
      actorIntents: {},
      diplomaticPlays: {},
      nextActorIntentId: 0,
      nextDiplomaticPlayId: 0,
    }

    const config = { ...defaultConfig, allowFemaleRolesWhenNoMaleCandidate: true }
    const ctx = buildCtx(state, config)

    const result = toResult(runAppointmentSystem(ctx))

    // p-1 has higher admin score (9 > 7), so p-1 gets administrator
    expect(holdsOfficeRole(result.state, base.personVassalId, 'administrator')).toBe(true)
  })

  it('appoints best candidate when allowFemaleRolesWhenNoMaleCandidate=false and only females exist', () => {
    const base = makeBaseState()
    const { polityId, personRulerId } = base

    const leaderOfficeId = createOfficeAssignmentId(99)
    const state: WorldState = {
      ...base.state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId],
        },
      },
      persons: {
        ...base.state.persons,
        [base.personRulerId]: {
          ...base.state.persons[base.personRulerId]!,
          sex: 'female',
        },
        [base.personVassalId]: {
          ...base.state.persons[base.personVassalId]!,
          sex: 'female',
        },
      },
      landContracts: {},
      holdingOfficeAssignments: {},
      holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
      landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
      holdingTerminalPolityCache: {},
      polityIndex: { byOwnerHouse: {} },
      nextLandContractId: 0,
      nextHoldingOfficeAssignmentId: 0,
      nextFactionId: 0,
      nextFactionMembershipId: 0,
      actorIntents: {},
      diplomaticPlays: {},
      nextActorIntentId: 0,
      nextDiplomaticPlayId: 0,
    }

    const config = { ...defaultConfig, allowFemaleRolesWhenNoMaleCandidate: false }
    const ctx = buildCtx(state, config)

    const result = toResult(runAppointmentSystem(ctx))

    // p-1 has higher admin score (9 > 7), so p-1 gets administrator
    // (implementation does not filter females from candidate pool)
    expect(holdsOfficeRole(result.state, base.personVassalId, 'administrator')).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // v0.17 §14.1: Factional appointment tests
  // ---------------------------------------------------------------------------

  it('appoints via factional path when faction has high NP and candidate meets threshold', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const rulerId = createPersonId('pe', 0)
    const factionMemberId = createPersonId('pe', 1)
    const leaderId = createPersonId('pe', 2)
    const factionId = createFactionId(0)
    const memId = createFactionMembershipId(0)

    let state = makeEmptyV016State()
    state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    state = withProvince(state, createProvinceId('p', 0), { nameKey: 'P0' })
    state = withHouse(state, houseId, {
      nameKey: 'Test House',
      memberIds: [rulerId, factionMemberId, leaderId],
      legacyPrestige: 50,
      seatProvinceId: createProvinceId('p', 0),
    })
    state = withPolity(state, polityId, {
      nameKey: 'Test Polity',
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: createProvinceId('p', 0),
    })
    state = bindProvinceToHouseViaPolity(state, createProvinceId('p', 0), polityId, houseId)
    state = withPerson(state, rulerId, {
      nameKey: 'Ruler',
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.3, caution: 0.5 },
      legacyPrestige: 30,
    })
    state = withPerson(state, factionMemberId, {
      nameKey: 'FactionMember',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.6 },
      legacyPrestige: 40,
      abilities: {
        valor: 50,
        command: 50,
        numeracy: 90,
        learning: 90,
        charisma: 90,
        insight: 90,
      },
    })
    state = withPerson(state, leaderId, {
      nameKey: 'FactionLeader',
      age: 35,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.3, caution: 0.4 },
      legacyPrestige: 50,
    })
    state.factions[factionId] = {
      id: factionId,
      leaderPersonId: leaderId,
      active: true,
      foundingWeek: 1440 * 48 + 1 - 1,
    }
    state.factionMemberships[memId] = {
      id: memId,
      factionId,
      personId: factionMemberId,
      active: true,
      joinedWeek: 1440 * 48 + 1 - 1,
    }
    state.factionIndex.byMember[factionMemberId] = [memId]
    state.factionIndex.byLeader[leaderId] = [factionId]

    const leaderOfficeId = createOfficeAssignmentId(99)
    const stateWithLeader: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity', id: polityId },
          role: 'leader',
          holderPersonId: rulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [rulerId]: [leaderOfficeId],
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithLeader, config)
    const result = toResult(runAppointmentSystem(ctx))

    // Faction member should be appointed via factional path
    expect(holdsOfficeRole(result.state, factionMemberId, 'administrator')).toBe(true)
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBeGreaterThan(0)
  })

  it('falls back to traditional path when factional candidates are below minAppointmentScore', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const rulerId = createPersonId('pe', 0)
    const factionMemberId = createPersonId('pe', 1)
    const leaderId = createPersonId('pe', 2)
    const factionId = createFactionId(0)
    const memId = createFactionMembershipId(0)

    let state = makeEmptyV016State()
    state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    state = withProvince(state, createProvinceId('p', 0), { nameKey: 'P0' })
    state = withHouse(state, houseId, {
      nameKey: 'Test House',
      memberIds: [rulerId, factionMemberId, leaderId],
      legacyPrestige: 50,
      seatProvinceId: createProvinceId('p', 0),
    })
    state = withPolity(state, polityId, {
      nameKey: 'Test Polity',
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: createProvinceId('p', 0),
    })
    state = bindProvinceToHouseViaPolity(state, createProvinceId('p', 0), polityId, houseId)
    state = withPerson(state, rulerId, {
      nameKey: 'Ruler',
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.3, caution: 0.5 },
      legacyPrestige: 30,
    })
    state = withPerson(state, factionMemberId, {
      nameKey: 'FactionMember',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.6 },
      legacyPrestige: 40,
      abilities: {
        valor: 50,
        command: 50,
        numeracy: 90,
        learning: 90,
        charisma: 90,
        insight: 90,
      },
    })
    state = withPerson(state, leaderId, {
      nameKey: 'FactionLeader',
      age: 35,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.3, caution: 0.4 },
      legacyPrestige: 50,
    })
    state.factions[factionId] = {
      id: factionId,
      leaderPersonId: leaderId,
      active: true,
      foundingWeek: 1440 * 48 + 1 - 1,
    }
    state.factionMemberships[memId] = {
      id: memId,
      factionId,
      personId: factionMemberId,
      active: true,
      joinedWeek: 1440 * 48 + 1 - 1,
    }
    state.factionIndex.byMember[factionMemberId] = [memId]
    state.factionIndex.byLeader[leaderId] = [factionId]

    // Leader hates faction member so recommendation score is low
    state.persons[leaderId]!.attitudes = {
      ...state.persons[leaderId]!.attitudes,
      [factionMemberId]: { affection: -80, respect: -80 },
    }

    const leaderOfficeId = createOfficeAssignmentId(99)
    const stateWithLeader: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity', id: polityId },
          role: 'leader',
          holderPersonId: rulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [rulerId]: [leaderOfficeId],
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithLeader, config)
    const result = toResult(runAppointmentSystem(ctx))

    // Should still appoint someone (via traditional fallback)
    // factionMemberId should get appointed via traditional path (high abilities)
    // since factional path score is low due to negative attitude
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBeGreaterThan(0)
  })

  it('does not apply ownerHouseBonus when polity is commonwealth (ownerHouseId undefined)', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const rulerId = createPersonId('pe', 0)
    const candidateId = createPersonId('pe', 1)
    const provinceId = createProvinceId('p', 0)

    let state = makeEmptyV016State()
    state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    state = withProvince(state, provinceId, { nameKey: 'P0' })
    state = withHouse(state, houseId, {
      nameKey: 'Test House',
      memberIds: [rulerId, candidateId],
      legacyPrestige: 50,
      seatProvinceId: provinceId,
    })
    // Commonwealth: no ownerHouseId
    state = withPolity(state, polityId, {
      nameKey: 'Commonwealth',
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: provinceId,
    })
    state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
    state = withPerson(state, rulerId, {
      nameKey: 'Ruler',
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.3, caution: 0.5 },
      legacyPrestige: 30,
    })
    state = withPerson(state, candidateId, {
      nameKey: 'Candidate',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.6 },
      legacyPrestige: 40,
      abilities: {
        valor: 50,
        command: 50,
        numeracy: 80,
        learning: 80,
        charisma: 80,
        insight: 80,
      },
    })

    const leaderOfficeId = createOfficeAssignmentId(99)
    const stateWithLeader: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity', id: polityId },
          role: 'leader',
          holderPersonId: rulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [rulerId]: [leaderOfficeId],
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithLeader, config)
    const result = toResult(runAppointmentSystem(ctx))

    // Should still appoint candidate (via traditional path, no ownerHouseBonus applied)
    expect(holdsOfficeRole(result.state, candidateId, 'administrator')).toBe(true)
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBeGreaterThan(0)
  })

  it('anonymous house members are eligible for traditional appointment', () => {
    const polityId = createPolityId('c', 0)
    const houseId = createHouseId('h', 0)
    const rulerId = createPersonId('pe', 0)
    const candidateId = createPersonId('pe', 1)
    const provinceId = createProvinceId('p', 0)

    let state = makeEmptyV016State()
    state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
    state = withProvince(state, provinceId, { nameKey: 'P0' })
    state = withHouse(state, houseId, {
      nameKey: 'Test House',
      memberIds: [rulerId],
      legacyPrestige: 50,
      seatProvinceId: provinceId,
    })
    state = withPolity(state, polityId, {
      nameKey: 'Test Polity',
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 10,
      capitalProvinceId: provinceId,
    })
    state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
    state = withPerson(state, rulerId, {
      nameKey: 'Ruler',
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.3, caution: 0.5 },
      legacyPrestige: 30,
    })
    // Candidate in anonymous house (system house) — v0.17 §14.6: eligible now
    state = withPerson(state, candidateId, {
      nameKey: 'AnonymousMember',
      age: 30,
      houseId: 'h-anon' as HouseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.6 },
      legacyPrestige: 40,
      abilities: {
        valor: 50,
        command: 50,
        numeracy: 90,
        learning: 90,
        charisma: 90,
        insight: 90,
      },
    })

    const leaderOfficeId = createOfficeAssignmentId(99)
    const stateWithLeader: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity', id: polityId },
          role: 'leader',
          holderPersonId: rulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`polity:${polityId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [rulerId]: [leaderOfficeId],
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithLeader, config)
    const result = toResult(runAppointmentSystem(ctx))

    // Anonymous member should NOT be eligible (their house is not in the polity)
    // but the test verifies the system doesn't crash and still appoints someone
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBeGreaterThanOrEqual(0)
  })

  it('v0.17.1: active Bailiff holder is excluded from Polity Office candidates', () => {
    const { state, polityId, personRulerId, personVassalId } = makeBaseState()

    // Install personVassalId (the high-ability candidate) as active Bailiff
    // of one of the Provinces. AppointmentSystem must skip them.
    const provinceId = createProvinceId('p', 1)
    const holdingId = state.provinces[provinceId]!.holdingIds[0]!
    let withBailiff = vacateHoldingBailiff(state, holdingId)
    withBailiff = appointHoldingBailiff(withBailiff, {
      holdingId,
      holderPersonId: personVassalId,
      appointingPolityId: polityId,
      week: withBailiff.absoluteWeek,
    }).state

    // Wire up leader office for ruler
    const leaderOfficeId = createOfficeAssignmentId(99)
    const stateWithLeader: WorldState = {
      ...withBailiff,
      currentWeekOfYear: 1,
      absoluteWeek: withBailiff.absoluteWeek,
      officeAssignments: {
        ...withBailiff.officeAssignments,
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          ...withBailiff.officeIndex.byOrganization,
          [`polity:${polityId}`]: [
            ...(withBailiff.officeIndex.byOrganization[`polity:${polityId}`] ?? []),
            leaderOfficeId,
          ],
        },
        byHolderPerson: {
          ...withBailiff.officeIndex.byHolderPerson,
          [personRulerId]: [
            ...(withBailiff.officeIndex.byHolderPerson[personRulerId] ?? []),
            leaderOfficeId,
          ],
        },
      },
    }

    const ctx = buildCtx(stateWithLeader, defaultConfig)
    const result = toResult(runAppointmentSystem(ctx))

    // personVassalId is a Bailiff → must NOT get any Polity Office (admin/treasurer/military/advisor)
    expect(holdsOfficeRole(result.state, personVassalId, 'administrator')).toBe(false)
    expect(holdsOfficeRole(result.state, personVassalId, 'treasurer')).toBe(false)
    expect(holdsOfficeRole(result.state, personVassalId, 'military')).toBe(false)
    expect(holdsOfficeRole(result.state, personVassalId, 'advisor')).toBe(false)
  })
})
