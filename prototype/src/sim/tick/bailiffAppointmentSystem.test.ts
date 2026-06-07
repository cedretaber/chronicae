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
  HoldingOfficeAssignmentId,
  HoldingId,
} from '../types/ids'
import type { WorldState } from '../types/world'
import type { Faction, FactionMembership } from '../types/faction'
import type { OfficeAssignment } from '../types/office'
import type { HoldingOfficeAssignment } from '../types/landContract'
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
  holdingId: HoldingId
  rulerId: PersonId
} {
  const polityId = createPolityId('c', 0)
  const houseId = createHouseId('h', 0)
  const provinceId = createProvinceId('p', 0)
  const rulerId = createPersonId('pe', 0)

  let s = makeEmptyV016State()
  s = { ...s, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  s = withProvince(s, provinceId, { nameKey: 'P0' })
  s = withHouse(s, houseId, {
    nameKey: 'Test House',
    memberIds: [rulerId],
    legacyPrestige: 50,
    seatProvinceId: provinceId,
  })
  s = withPolity(s, polityId, {
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  s = bindProvinceToPolity(s, provinceId, polityId)
  s = withPerson(s, rulerId, {
    nameKey: 'Ruler',
    houseId,
    birthStatus: 'unknown',
    traits: { ambition: 0.3, caution: 0.5 },
    legacyPrestige: 30,
  })

  const holdingId = s.provinces[provinceId]!.holdingIds[0]!

  return { state: s, polityId, houseId, provinceId, holdingId, rulerId }
}

function countEvents(events: readonly SimEvent[], type: string): number {
  return events.filter((e) => e.type === type).length
}

describe('runBailiffAppointmentSystem', () => {
  it('vacates bailiff whose term has expired (startWeek = absoluteWeek - 3 years)', () => {
    const { state: baseState, holdingId, houseId } = makeBaseState()
    // Set month so absMonth % 6 === 0 (bailiffAppointmentInterval)
    const s: WorldState = {
      ...baseState,
      currentWeekOfYear: 6,
      absoluteWeek: baseState.currentYear * 48 + 6 - 1,
    }

    const bailiffId = createPersonId('pe', 10)
    const stateWithBailiff = withPerson(s, bailiffId, {
      nameKey: 'Bailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.5 },
      legacyPrestige: 20,
      abilities: DEFAULT_ABILITIES,
    })

    // Install a non-placeholder bailiff with startYear = currentYear - 3
    const officeId = stateWithBailiff.holdingOfficeIndex.byHolding[
      holdingId
    ] as HoldingOfficeAssignmentId
    const office = stateWithBailiff.holdingOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    const updatedState: WorldState = {
      ...stateWithBailiff,
      holdingOfficeAssignments: {
        ...stateWithBailiff.holdingOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startWeek: stateWithBailiff.absoluteWeek - 3 * 48,
        },
      },
      holdingOfficeIndex: {
        ...stateWithBailiff.holdingOfficeIndex,
        byHolderPerson: {
          ...stateWithBailiff.holdingOfficeIndex.byHolderPerson,
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
    const { state: baseState, holdingId, houseId } = makeBaseState()
    const bailiffId = createPersonId('pe', 10)

    const stateWithBailiff = withPerson(baseState, bailiffId, {
      nameKey: 'Bailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.2, caution: 0.5 },
      legacyPrestige: 20,
      abilities: DEFAULT_ABILITIES,
    })

    // Install a bailiff with startYear = currentYear (not expired yet)
    const officeId = stateWithBailiff.holdingOfficeIndex.byHolding[
      holdingId
    ] as HoldingOfficeAssignmentId
    const office = stateWithBailiff.holdingOfficeAssignments[officeId]
    if (!officeId || !office) throw new Error('no bailiff office found')

    const updatedState: WorldState = {
      ...stateWithBailiff,
      holdingOfficeAssignments: {
        ...stateWithBailiff.holdingOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startYear: stateWithBailiff.currentYear,
        },
      },
      holdingOfficeIndex: {
        ...stateWithBailiff.holdingOfficeIndex,
        byHolderPerson: {
          ...stateWithBailiff.holdingOfficeIndex.byHolderPerson,
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
    const { state: baseState, polityId, houseId, holdingId } = makeBaseState()
    let s: WorldState = {
      ...baseState,
      currentWeekOfYear: 6,
      absoluteWeek: baseState.currentYear * 48 + 6 - 1,
    }

    // Faction leader sits in the ownerHouse → NP gets +0.3 (ownerHouse bonus) → meets threshold (0.30)
    const leaderId = createPersonId('pe', 5)
    s = withPerson(s, leaderId, {
      nameKey: 'FactionLeader',
      age: 35,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 50,
      abilities: DEFAULT_ABILITIES,
    })

    // Faction member in a DIFFERENT house (outside the ownerHouse) — pool expansion target
    const memberHouseId = createHouseId('h', 1)
    s = withHouse(s, memberHouseId, { nameKey: 'OutsiderHouse', memberIds: [] })
    const memberId = createPersonId('pe', 6)
    s = withPerson(s, memberId, {
      nameKey: 'OutsiderFactionMember',
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
      leaderPersonId: leaderId,
      polityId: createPolityId('c', 0),
      active: true,
      foundingWeek: s.currentYear * 48 + s.currentWeekOfYear - 1,
    }
    const leaderMembership: FactionMembership = {
      id: leaderMembershipId,
      factionId,
      personId: leaderId,
      active: true,
      joinedWeek: s.currentYear * 48 + s.currentWeekOfYear - 1,
    }
    const memberMembership: FactionMembership = {
      id: memberMembershipId,
      factionId,
      personId: memberId,
      active: true,
      joinedWeek: s.currentYear * 48 + s.currentWeekOfYear - 1,
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
        byPolity: { ...s.factionIndex.byPolity, [createPolityId('c', 0)]: [factionId] },
        byMember: {
          ...s.factionIndex.byMember,
          [leaderId]: [leaderMembershipId],
          [memberId]: [memberMembershipId],
        },
      },
      nextFactionId: 1,
      nextFactionMembershipId: 2,
      diplomaticPlays: {},
      nextDiplomaticPlayId: 0,
    }

    const ctx = createTickContext({ state: s, rng: createRng('test'), config: defaultConfig })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    const officeId = result.state.holdingOfficeIndex.byHolding[holdingId]!
    const office = result.state.holdingOfficeAssignments[officeId]!
    expect(office.holderPersonId).toBe(memberId)
    expect(office.appointingPolityId).toBe(polityId)
    expect(countEvents(result.events, 'BAILIFF_APPOINTED')).toBeGreaterThan(0)
  })

  it('factional candidate with active Polity Office is excluded', () => {
    const { state: baseState, polityId, houseId, holdingId } = makeBaseState()
    let s: WorldState = {
      ...baseState,
      currentWeekOfYear: 6,
      absoluteWeek: baseState.currentYear * 48 + 6 - 1,
    }

    // Faction leader in ownerHouse to satisfy NP
    const leaderId = createPersonId('pe', 5)
    s = withPerson(s, leaderId, {
      nameKey: 'FactionLeader',
      age: 35,
      houseId,
      birthStatus: 'unknown',
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 50,
      abilities: DEFAULT_ABILITIES,
    })

    const memberHouseId = createHouseId('h', 1)
    s = withHouse(s, memberHouseId, { nameKey: 'OutsiderHouse', memberIds: [] })
    const memberId = createPersonId('pe', 6)
    s = withPerson(s, memberId, {
      nameKey: 'BusyMember',
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
      slotIndex: 0,
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
          nameKey: 'F',
          leaderPersonId: leaderId,
          polityId: createPolityId('c', 0),
          active: true,
          foundingWeek: s.currentYear * 48 + s.currentWeekOfYear - 1,
        },
      },
      factionMemberships: {
        ...s.factionMemberships,
        [leaderMembershipId]: {
          id: leaderMembershipId,
          factionId,
          personId: leaderId,
          active: true,
          joinedWeek: s.currentYear * 48 + s.currentWeekOfYear - 1,
        },
        [memberMembershipId]: {
          id: memberMembershipId,
          factionId,
          personId: memberId,
          active: true,
          joinedWeek: s.currentYear * 48 + s.currentWeekOfYear - 1,
        },
      },
      factionIndex: {
        byLeader: { ...s.factionIndex.byLeader, [leaderId]: [factionId] },
        byPolity: { ...s.factionIndex.byPolity, [createPolityId('c', 0)]: [factionId] },
        byMember: {
          ...s.factionIndex.byMember,
          [leaderId]: [leaderMembershipId],
          [memberId]: [memberMembershipId],
        },
      },
      nextFactionId: 1,
      nextFactionMembershipId: 2,
      diplomaticPlays: {},
      nextDiplomaticPlayId: 0,
    }

    const ctx = createTickContext({ state: s, rng: createRng('test'), config: defaultConfig })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // Expected: factional path skips busy member → fallback to ownerHouse (faction leader is in dh-0,
    // and ruler pe-0 is also in dh-0). The chosen bailiff must NOT be the busy member.
    const officeId = result.state.holdingOfficeIndex.byHolding[holdingId]!
    const office = result.state.holdingOfficeAssignments[officeId]!
    expect(office.holderPersonId).not.toBe(memberId)
  })

  it('v0.17.2: alive non-ownerHouse bailiff is NOT vacated by step 1 (factional bailiff stable)', () => {
    const { state: baseState, polityId, houseId, holdingId } = makeBaseState()
    let s: WorldState = {
      ...baseState,
      currentWeekOfYear: 6,
      absoluteWeek: baseState.currentYear * 48 + 6 - 1,
    }

    // Install an outsider bailiff (alive, normal, not in ownerHouse) — simulates a factional bailiff
    // that was already appointed in a previous tick. The new step 1 must NOT vacate this person.
    const outsiderHouseId = createHouseId('h', 9)
    s = withHouse(s, outsiderHouseId, { nameKey: 'OutsiderHouse' })
    const bailiffId = createPersonId('pe', 50)
    s = withPerson(s, bailiffId, {
      nameKey: 'FactionalBailiff',
      age: 30,
      houseId: outsiderHouseId,
      birthStatus: 'unknown',
      legacyPrestige: 50,
    })
    // Install the bailiff manually with startYear = currentYear (term not expired)
    void houseId
    const officeId = s.holdingOfficeIndex.byHolding[holdingId] as HoldingOfficeAssignmentId
    const office = s.holdingOfficeAssignments[officeId] as HoldingOfficeAssignment
    if (!officeId || !office) throw new Error('no bailiff office found')
    s = {
      ...s,
      holdingOfficeAssignments: {
        ...s.holdingOfficeAssignments,
        [officeId]: {
          ...office,
          holderPersonId: bailiffId,
          startYear: s.currentYear,
        },
      },
      holdingOfficeIndex: {
        ...s.holdingOfficeIndex,
        byHolderPerson: {
          ...s.holdingOfficeIndex.byHolderPerson,
          [bailiffId]: [officeId],
        },
      },
    }

    const ctx = createTickContext({ state: s, rng: createRng('test'), config: defaultConfig })
    const result = toResult(runBailiffAppointmentSystem(ctx))

    // The factional bailiff should remain in office
    expect(countEvents(result.events, 'BAILIFF_VACATED')).toBe(0)
    expect(countEvents(result.events, 'BAILIFF_PLACEHOLDER_INSTALLED')).toBe(0)
    const afterOfficeId = result.state.holdingOfficeIndex.byHolding[holdingId]
    expect(afterOfficeId).toBe(officeId)
    expect(result.state.holdingOfficeAssignments[afterOfficeId!]?.holderPersonId).toBe(bailiffId)
    void polityId
  })

  it('v0.17.2: dead bailiff IS vacated by step 1', () => {
    const { state: baseState, houseId, holdingId } = makeBaseState()
    let s: WorldState = {
      ...baseState,
      currentWeekOfYear: 6,
      absoluteWeek: baseState.currentYear * 48 + 6 - 1,
    }

    const bailiffId = createPersonId('pe', 51)
    s = withPerson(s, bailiffId, {
      nameKey: 'DeadBailiff',
      age: 30,
      houseId,
      birthStatus: 'unknown',
      alive: false,
    })
    const officeId = s.holdingOfficeIndex.byHolding[holdingId] as HoldingOfficeAssignmentId
    const office = s.holdingOfficeAssignments[officeId] as HoldingOfficeAssignment
    if (!officeId || !office) throw new Error('no bailiff office found')
    s = {
      ...s,
      holdingOfficeAssignments: {
        ...s.holdingOfficeAssignments,
        [officeId]: { ...office, holderPersonId: bailiffId, startYear: s.currentYear },
      },
      holdingOfficeIndex: {
        ...s.holdingOfficeIndex,
        byHolderPerson: {
          ...s.holdingOfficeIndex.byHolderPerson,
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
    const { state: baseState, holdingId } = makeBaseState()

    const officeId = baseState.holdingOfficeIndex.byHolding[holdingId] as HoldingOfficeAssignmentId
    const office = baseState.holdingOfficeAssignments[officeId] as HoldingOfficeAssignment
    if (!officeId || !office) throw new Error('no bailiff office found')

    // Placeholder bailiff (holder starts with 'pe-anon')
    const placeholderId = 'pe-anon-placeholder' as PersonId
    const updatedState: WorldState = {
      ...baseState,
      ...baseState.holdingOfficeAssignments,
      [officeId]: {
        ...office,
        holderPersonId: placeholderId,
        startYear: baseState.currentYear - 10,
      },
      holdingOfficeIndex: {
        ...baseState.holdingOfficeIndex,
        byHolderPerson: {
          ...baseState.holdingOfficeIndex.byHolderPerson,
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

// ─── v0.45.3 性別役職適格ゲート ───

describe('runBailiffAppointmentSystem の性別役職適格ゲート (v0.45.3)', () => {
  // makeBaseState の ruler (唯一の ownerHouse free adult) を female 化し、
  // placeholder bailiff の充足が gate / fallback でどう変わるかを検証する
  function makeFemaleCandidateState(): { s: WorldState; holdingId: HoldingId; rulerId: PersonId } {
    const { state: baseState, holdingId, rulerId } = makeBaseState()
    const s: WorldState = {
      ...baseState,
      currentWeekOfYear: 6,
      absoluteWeek: baseState.currentYear * 48 + 6 - 1,
      persons: {
        ...baseState.persons,
        [rulerId]: { ...baseState.persons[rulerId]!, sex: 'female' },
      },
    }
    return { s, holdingId, rulerId }
  }

  it('不適格な female 候補のみ + fallback off → placeholder のまま (任命なし)', () => {
    const { s } = makeFemaleCandidateState()
    const config = {
      ...defaultConfig,
      femaleRoleEligibilityChance: 0,
      allowFemaleRolesWhenNoMaleCandidate: false,
    }
    const ctx = createTickContext({ state: s, rng: createRng('test'), config })
    const result = toResult(runBailiffAppointmentSystem(ctx))
    expect(countEvents(result.events, 'BAILIFF_APPOINTED')).toBe(0)
  })

  it('不適格な female 候補のみ + fallback on → ungated 再試行で任命される', () => {
    const { s, holdingId, rulerId } = makeFemaleCandidateState()
    const config = {
      ...defaultConfig,
      femaleRoleEligibilityChance: 0,
      allowFemaleRolesWhenNoMaleCandidate: true,
    }
    const ctx = createTickContext({ state: s, rng: createRng('test'), config })
    const result = toResult(runBailiffAppointmentSystem(ctx))
    expect(countEvents(result.events, 'BAILIFF_APPOINTED')).toBeGreaterThan(0)
    const officeId = result.state.holdingOfficeIndex.byHolding[holdingId]!
    expect(result.state.holdingOfficeAssignments[officeId]?.holderPersonId).toBe(rulerId)
  })
})
