import { describe, expect, it } from 'vitest'
import {
  createCountryId,
  createHouseId,
  createOfficeAssignmentId,
  createPersonId,
} from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runAppointmentSystem } from './appointmentSystem'
import type { SimEvent } from '../types/event'
import type { OfficeRole } from '../types/office'

function makeBaseState(): {
  state: WorldState
  countryId: CountryId
  houseRulerId: HouseId
  houseVassalId: HouseId
  personRulerId: PersonId
  personVassalId: PersonId
} {
  const countryId = createCountryId('c', 0)
  const houseRulerId = createHouseId('h', 0)
  const houseVassalId = createHouseId('h', 1)
  const personRulerId = createPersonId('pe', 0)
  const personVassalId = createPersonId('pe', 1)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [countryId]: {
        id: countryId,
        name: 'Country 1',
        houseIds: [houseRulerId, houseVassalId],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [houseRulerId]: {
        id: houseRulerId,
        name: 'Ruler House',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [personRulerId],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
      [houseVassalId]: {
        id: houseVassalId,
        name: 'Vassal House',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [personVassalId],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [personRulerId]: {
        id: personRulerId,
        name: 'Ruler Person',
        sex: 'male',
        age: 30,
        alive: true,
        houseId: houseRulerId,
        countryId,
        childIds: [],
        birthStatus: 'unknown',
        stats: { admin: 7, martial: 5 },
        traits: { ambition: 0.3, caution: 0.5 },
        legacyPrestige: 30,
        wealth: 0,
        attitudes: {},
      },
      [personVassalId]: {
        id: personVassalId,
        name: 'Vassal Person',
        sex: 'male',
        age: 35,
        alive: true,
        houseId: houseVassalId,
        countryId,
        childIds: [],
        birthStatus: 'unknown',
        stats: { admin: 9, martial: 6 },
        traits: { ambition: 0.2, caution: 0.6 },
        legacyPrestige: 40,
        wealth: 0,
        attitudes: {},
      },
    },
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  }

  return {
    state,
    countryId,
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
    const { state, countryId, personRulerId, personVassalId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const stateWithLeader: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId],
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
    const { state, countryId, personRulerId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const adminOfficeId = createOfficeAssignmentId(100)
    const stateWithOffices: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
        [adminOfficeId]: {
          id: adminOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'administrator',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId, adminOfficeId],
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
    // vassal fills treasurer and military; advisor score drops below minAppointmentScore
    // due to concurrentOfficePenalty accumulating across multiple offices
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBe(2)
    expect(countEvents(result.events, 'OFFICE_REVOKED')).toBe(0)
  })

  it('replaces current holder on January when score diff >= replacementThreshold', () => {
    const { state, countryId, personRulerId, personVassalId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const adminOfficeId = createOfficeAssignmentId(100)
    const stateWithOffices: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
        [adminOfficeId]: {
          id: adminOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'administrator',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId, adminOfficeId],
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

  it('does not run in non-January months', () => {
    const { state, countryId, personRulerId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const adminOfficeId = createOfficeAssignmentId(100)
    const stateWithOffices: WorldState = {
      ...state,
      currentMonth: 2,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
        [adminOfficeId]: {
          id: adminOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'administrator',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId, adminOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId, adminOfficeId],
        },
      },
    }

    const config = { ...defaultConfig }
    const ctx = buildCtx(stateWithOffices, config)

    const result = toResult(runAppointmentSystem(ctx))

    // System doesn't run in non-January months - no appointments or replacements
    expect(holdsOfficeRole(result.state, personRulerId, 'administrator')).toBe(true)
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBe(0)
    expect(countEvents(result.events, 'OFFICE_REVOKED')).toBe(0)
  })

  it('revokes dead person office and appoints new person', () => {
    const { state, countryId, personRulerId, personVassalId } = makeBaseState()

    const leaderOfficeId = createOfficeAssignmentId(99)
    const adminOfficeId = createOfficeAssignmentId(100)
    const stateWithOffices: WorldState = {
      ...state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
        [adminOfficeId]: {
          id: adminOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'administrator',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId, adminOfficeId],
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
    // vassal fills administrator and treasurer; military/advisor score drops below minAppointmentScore
    // due to concurrentOfficePenalty accumulating after each appointment
    expect(countEvents(result.events, 'OFFICE_ASSIGNED')).toBe(2)
  })

  it('concurrent office penalty reduces score for already-office-holding candidates', () => {
    const base = makeBaseState()
    const { countryId, personRulerId, personVassalId } = base

    const leaderOfficeId = createOfficeAssignmentId(99)
    const state: WorldState = {
      ...base.state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId],
        },
        byHolderPerson: {
          [personRulerId]: [leaderOfficeId],
        },
      },
      persons: {
        ...base.state.persons,
        [base.personRulerId]: {
          ...base.state.persons[base.personRulerId]!,
          stats: { admin: 10, martial: 5 },
        },
      },
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
    const { countryId, personRulerId } = base

    const leaderOfficeId = createOfficeAssignmentId(99)
    const state: WorldState = {
      ...base.state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId],
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
    }

    const config = { ...defaultConfig, allowFemaleRolesWhenNoMaleCandidate: true }
    const ctx = buildCtx(state, config)

    const result = toResult(runAppointmentSystem(ctx))

    // p-1 has higher admin score (9 > 7), so p-1 gets administrator
    expect(holdsOfficeRole(result.state, base.personVassalId, 'administrator')).toBe(true)
  })

  it('appoints best candidate when allowFemaleRolesWhenNoMaleCandidate=false and only females exist', () => {
    const base = makeBaseState()
    const { countryId, personRulerId } = base

    const leaderOfficeId = createOfficeAssignmentId(99)
    const state: WorldState = {
      ...base.state,
      officeAssignments: {
        [leaderOfficeId]: {
          id: leaderOfficeId,
          organization: { kind: 'country' as const, id: countryId },
          role: 'leader',
          holderPersonId: personRulerId,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: {
          [`country:${countryId}`]: [leaderOfficeId],
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
    }

    const config = { ...defaultConfig, allowFemaleRolesWhenNoMaleCandidate: false }
    const ctx = buildCtx(state, config)

    const result = toResult(runAppointmentSystem(ctx))

    // p-1 has higher admin score (9 > 7), so p-1 gets administrator
    // (implementation does not filter females from candidate pool)
    expect(holdsOfficeRole(result.state, base.personVassalId, 'administrator')).toBe(true)
  })
})
