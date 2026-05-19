import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type {
  PolityId,
  HouseId,
  PersonId,
  ProvinceId,
  FactionId,
  FactionMembershipId,
  OfficeAssignmentId,
} from '../types/ids'
import type { ProvinceOfficeAssignmentId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { Faction, FactionMembership } from '../types/faction'
import type { OfficeAssignment } from '../types/office'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext, toResult } from './context'
import { runBailiffAppointmentSystem } from './bailiffAppointmentSystem'
import type { SimEvent } from '../types/event'
import {
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
  bindProvinceToPolity,
} from '../testFixtures'

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
  houseId: HouseId
  provinceId: ProvinceId
  rulerId: PersonId
} {
  const polityId = createPolityId('c', 0)
  const houseId = createHouseId('h', 0)
  const provinceId = createProvinceId('p', 0)
  const rulerId = createPersonId('pe', 0)

  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, currentMonth: 1 }
  s = withProvince(s, provinceId, { name: 'P0', development: 10 })
  s = withHouse(s, houseId, {
    name: 'Test House',
    memberIds: [rulerId],
    legacyPrestige: 50,
    seatProvinceId: provinceId,
  })
  s = withPolity(s, polityId, {
    name: 'Test Polity',
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  s = bindProvinceToPolity(s, provinceId, polityId)
  s = withPerson(s, rulerId, {
    name: 'Ruler',
    houseId,
    birthStatus: 'unknown',
    traits: { ambition: 0.3, caution: 0.5 },
    legacyPrestige: 30,
  })

  return { state: s, polityId, houseId, provinceId, rulerId }
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runBailiffAppointmentSystem', () => {
  it('vacates bailiff whose term has expired (startYear = currentYear - 3)', () => {
    const { state: baseState, houseId, provinceId } = makeBaseState()
    // Set month so absMonth % 6 === 0 (bailiffAppointmentInterval)
    const s: WorldState = { ...baseState, currentMonth: 6 }

    const bailiffId = createPersonId('pe', 10)
    const stateWithBailiff = withPerson(s, bailiffId, {
      name: 'Bailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.5 },
      legacyPrestige: 20,
      abilities: DEFAULT_ABILITIES,
    })

    // Install a non-placeholder bailiff with startYear = currentYear - 3
    const officeId = stateWithBailiff.provinceOfficeIndex.byProvince[
      provinceId
    ] as ProvinceOfficeAssignmentId
    const office = stateWithBailiff.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    const updatedState: WorldState = {
      ...stateWithBailiff,
      provinceOfficeAssignments: {
        ...stateWithBailiff.provinceOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startYear: stateWithBailiff.currentYear - 3,
        },
      },
      provinceOfficeIndex: {
        ...stateWithBailiff.provinceOfficeIndex,
        byHolderPerson: {
          ...stateWithBailiff.provinceOfficeIndex.byHolderPerson,
          [bailiffId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({
      state: updatedState,
      rng: createRng('test'),
      config: defaultConfig,
    })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Bailiff should be vacated and placeholder installed
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBeGreaterThan(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBeGreaterThan(0)
  })

  it('does NOT vacate bailiff whose term has not expired (startYear = currentYear)', () => {
    const { state: baseState, houseId, provinceId } = makeBaseState()
    const bailiffId = createPersonId('pe', 10)

    const stateWithBailiff = withPerson(baseState, bailiffId, {
      name: 'Bailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.5 },
      legacyPrestige: 20,
      abilities: DEFAULT_ABILITIES,
    })

    // Install a bailiff with startYear = currentYear (not expired yet)
    const officeId = stateWithBailiff.provinceOfficeIndex.byProvince[
      provinceId
    ] as ProvinceOfficeAssignmentId
    const office = stateWithBailiff.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    const updatedState: WorldState = {
      ...stateWithBailiff,
      provinceOfficeAssignments: {
        ...stateWithBailiff.provinceOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startYear: stateWithBailiff.currentYear,
        },
      },
      provinceOfficeIndex: {
        ...stateWithBailiff.provinceOfficeIndex,
        byHolderPerson: {
          ...stateWithBailiff.provinceOfficeIndex.byHolderPerson,
          [bailiffId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({
      state: updatedState,
      rng: createRng('test'),
      config: defaultConfig,
    })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Bailiff should NOT be vacated (term not expired)
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBe(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBe(0)
  })

  it('factional path: picks faction member outside ownerHouse when NP >= threshold', () => {
    const { state: baseState, polityId, houseId, provinceId } = makeBaseState()
    // currentMonth=6 so absMonth % 6 === 0
    let s: WorldState = { ...baseState, currentMonth: 6 }

    // Faction leader sits in the ownerHouse → NP gets +0.3 (ownerHouse bonus) → meets threshold (0.30)
    const leaderId = createPersonId('pe', 5)
    s = withPerson(s, leaderId, {
      name: 'FactionLeader',
      age: 35,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 50,
      abilities: DEFAULT_ABILITIES,
    })

    // Faction member in a DIFFERENT house (outside the ownerHouse) — pool expansion target
    const memberHouseId = createHouseId('h', 1)
    s = withHouse(s, memberHouseId, { name: 'OutsiderHouse', memberIds: [] })
    const memberId = createPersonId('pe', 6)
    s = withPerson(s, memberId, {
      name: 'OutsiderFactionMember',
      age: 30,
      houseId: memberHouseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.5, caution: 0.5 },
      // Higher prestige than the leader so the factional pool picks the outsider candidate.
      legacyPrestige: 100,
      abilities: DEFAULT_ABILITIES,
    })

    const factionId = 'f-0' as unknown as FactionId
    const leaderMembershipId = 'fm-0' as unknown as FactionMembershipId
    const memberMembershipId = 'fm-1' as unknown as FactionMembershipId
    const faction: Faction = {
      id: factionId,
      name: 'TestFaction',
      leaderPersonId: leaderId,
      active: true,
      foundingYear: s.currentYear,
      foundingMonth: s.currentMonth,
    }
    const leaderMembership: FactionMembership = {
      id: leaderMembershipId,
      factionId,
      personId: leaderId,
      active: true,
      joinedYear: s.currentYear,
      joinedMonth: s.currentMonth,
    }
    const memberMembership: FactionMembership = {
      id: memberMembershipId,
      factionId,
      personId: memberId,
      active: true,
      joinedYear: s.currentYear,
      joinedMonth: s.currentMonth,
    }
    s = {
      ...s,
      factions: { ...s.factions, [factionId]: faction },
      factionMemberships: {
        ...s.factionMemberships,
        [leaderMembershipId]: leaderMembership,
        [memberMembershipId]: memberMembership,
      },
      factionIndex: {
        byLeader: { ...s.factionIndex.byLeader, [leaderId]: [factionId] },
        byMember: {
          ...s.factionIndex.byMember,
          [leaderId]: [leaderMembershipId],
          [memberId]: [memberMembershipId],
        },
      },
      nextFactionId: 1,
      nextFactionMembershipId: 2,
    }

    const ctx = createTickContext({ state: s, rng: createRng('test'), config: defaultConfig })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    const officeId = result.state.provinceOfficeIndex.byProvince[provinceId]!
    const office = result.state.provinceOfficeAssignments[officeId]!
    expect(office.holderPersonId).toBe(memberId)
    expect(office.appointingPolityId).toBe(polityId)
    expect(countEvents(result.events, 'BAILIFF_APPOINTED')).toBeGreaterThan(0)
  })

  it('factional candidate with active Polity Office is excluded', () => {
    const { state: baseState, polityId, houseId, provinceId } = makeBaseState()
    let s: WorldState = { ...baseState, currentMonth: 6 }

    // Faction leader in ownerHouse to satisfy NP
    const leaderId = createPersonId('pe', 5)
    s = withPerson(s, leaderId, {
      name: 'FactionLeader',
      age: 35,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 50,
      abilities: DEFAULT_ABILITIES,
    })

    const memberHouseId = createHouseId('h', 1)
    s = withHouse(s, memberHouseId, { name: 'OutsiderHouse', memberIds: [] })
    const memberId = createPersonId('pe', 6)
    s = withPerson(s, memberId, {
      name: 'BusyMember',
      age: 30,
      houseId: memberHouseId,
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
    })

    // Give the candidate an active Polity Office → must be excluded from factional candidates
    const existingOfficeId = 'of-existing' as unknown as OfficeAssignmentId
    const existingOffice: OfficeAssignment = {
      id: existingOfficeId,
      organization: { kind: 'polity', id: polityId },
      role: 'advisor',
      holderPersonId: memberId,
      active: true,
      startYear: s.currentYear,
      unpaidCount: 0,
    }
    s = {
      ...s,
      officeAssignments: { ...s.officeAssignments, [existingOfficeId]: existingOffice },
      officeIndex: {
        byOrganization: {
          ...s.officeIndex.byOrganization,
          [`polity:${polityId}`]: [
            ...(s.officeIndex.byOrganization[`polity:${polityId}`] ?? []),
            existingOfficeId,
          ],
        },
        byHolderPerson: {
          ...s.officeIndex.byHolderPerson,
          [memberId]: [existingOfficeId],
        },
      },
    }

    const factionId = 'f-0' as unknown as FactionId
    const leaderMembershipId = 'fm-0' as unknown as FactionMembershipId
    const memberMembershipId = 'fm-1' as unknown as FactionMembershipId
    s = {
      ...s,
      factions: {
        ...s.factions,
        [factionId]: {
          id: factionId,
          name: 'F',
          leaderPersonId: leaderId,
          active: true,
          foundingYear: s.currentYear,
          foundingMonth: s.currentMonth,
        },
      },
      factionMemberships: {
        ...s.factionMemberships,
        [leaderMembershipId]: {
          id: leaderMembershipId,
          factionId,
          personId: leaderId,
          active: true,
          joinedYear: s.currentYear,
          joinedMonth: s.currentMonth,
        },
        [memberMembershipId]: {
          id: memberMembershipId,
          factionId,
          personId: memberId,
          active: true,
          joinedYear: s.currentYear,
          joinedMonth: s.currentMonth,
        },
      },
      factionIndex: {
        byLeader: { ...s.factionIndex.byLeader, [leaderId]: [factionId] },
        byMember: {
          ...s.factionIndex.byMember,
          [leaderId]: [leaderMembershipId],
          [memberId]: [memberMembershipId],
        },
      },
      nextFactionId: 1,
      nextFactionMembershipId: 2,
    }

    const ctx = createTickContext({ state: s, rng: createRng('test'), config: defaultConfig })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Expected: factional path skips busy member → fallback to ownerHouse (faction leader is in dh-0,
    // and ruler pe-0 is also in dh-0). The chosen bailiff must NOT be the busy member.
    const officeId = result.state.provinceOfficeIndex.byProvince[provinceId]!
    const office = result.state.provinceOfficeAssignments[officeId]!
    expect(office.holderPersonId).not.toBe(memberId)
  })

  it('v0.17.2: alive non-ownerHouse bailiff is NOT vacated by step 1 (factional bailiff stable)', () => {
    const { state: baseState, polityId, houseId, provinceId } = makeBaseState()
    let s: WorldState = { ...baseState, currentMonth: 6 }

    // Install an outsider bailiff (alive, normal, not in ownerHouse) — simulates a factional bailiff
    // that was already appointed in a previous tick. The new step 1 must NOT vacate this person.
    const outsiderHouseId = createHouseId('h', 9)
    s = withHouse(s, outsiderHouseId, { name: 'OutsiderHouse' })
    const bailiffId = createPersonId('pe', 50)
    s = withPerson(s, bailiffId, {
      name: 'FactionalBailiff',
      age: 30,
      houseId: outsiderHouseId,
      birthStatus: 'unknown',
      legacyPrestige: 50,
    })
    // Install the bailiff manually with startYear = currentYear (term not expired)
    void houseId
    const officeId = s.provinceOfficeIndex.byProvince[provinceId] as ProvinceOfficeAssignmentId
    const office = s.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')
    s = {
      ...s,
      provinceOfficeAssignments: {
        ...s.provinceOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startYear: s.currentYear,
        },
      },
      provinceOfficeIndex: {
        ...s.provinceOfficeIndex,
        byHolderPerson: {
          ...s.provinceOfficeIndex.byHolderPerson,
          [bailiffId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({ state: s, rng: createRng('test'), config: defaultConfig })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // The factional bailiff should remain in office
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBe(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBe(0)
    const afterOfficeId = result.state.provinceOfficeIndex.byProvince[provinceId]
    expect(afterOfficeId).toBe(officeId)
    expect(result.state.provinceOfficeAssignments[afterOfficeId!]?.holderPersonId).toBe(bailiffId)
    void polityId
  })

  it('v0.17.2: dead bailiff IS vacated by step 1', () => {
    const { state: baseState, houseId, provinceId } = makeBaseState()
    let s: WorldState = { ...baseState, currentMonth: 6 }

    const bailiffId = createPersonId('pe', 51)
    s = withPerson(s, bailiffId, {
      name: 'DeadBailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      alive: false,
    })
    const officeId = s.provinceOfficeIndex.byProvince[provinceId] as ProvinceOfficeAssignmentId
    const office = s.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')
    s = {
      ...s,
      provinceOfficeAssignments: {
        ...s.provinceOfficeAssignments,
        [officeId]: { ...office, holderPersonId: bailiffId, startYear: s.currentYear },
      },
      provinceOfficeIndex: {
        ...s.provinceOfficeIndex,
        byHolderPerson: {
          ...s.provinceOfficeIndex.byHolderPerson,
          [bailiffId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({ state: s, rng: createRng('test'), config: defaultConfig })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBeGreaterThan(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBeGreaterThan(0)
  })

  it('does NOT vacate placeholder bailiff by term', () => {
    const { state: baseState, provinceId } = makeBaseState()

    const officeId = baseState.provinceOfficeIndex.byProvince[
      provinceId
    ] as ProvinceOfficeAssignmentId
    const office = baseState.provinceOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    // Placeholder bailiff (holder starts with 'pe-anon')
    const placeholderId = 'pe-anon-placeholder' as PersonId
    const updatedState: WorldState = {
      ...baseState,
      provinceOfficeAssignments: {
        ...baseState.provinceOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: placeholderId,
          startYear: baseState.currentYear - 10,
        },
      },
      provinceOfficeIndex: {
        ...baseState.provinceOfficeIndex,
        byHolderPerson: {
          ...baseState.provinceOfficeIndex.byHolderPerson,
          [placeholderId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({
      state: updatedState,
      rng: createRng('test'),
      config: defaultConfig,
    })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Placeholder should NOT be vacated by term
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBe(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBe(0)
  })
})
