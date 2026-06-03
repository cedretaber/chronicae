import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createPersonId,
  createOfficeAssignmentId,
  createFactionId,
  createProvinceId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { OfficeAssignment } from '../types/office'
import {
  getEffectiveOfficeMaxHolders,
  isOfficeTermExpired,
  getHousePolityOfficeOverlapScore,
  getOfficeCompatibilityPenalty,
} from './officeSelectors'
import { getActiveFactions, getFaction } from './factionSelectors'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { defaultConfig } from '../config/defaultConfig'

function makeFixture(): {
  state: WorldState
  config: SimulationConfig
  polityId: PolityId
  houseId: HouseId
  leaderId: PersonId
  adminId: PersonId
  treasurerId: PersonId
  militaryId: PersonId
  advisorId: PersonId
  provinceId: ProvinceId
} {
  const polityId = createPolityId('c', 0)
  const houseId = createHouseId('h', 0)
  const leaderId = createPersonId('pe', 0)
  const adminId = createPersonId('pe', 1)
  const treasurerId = createPersonId('pe', 2)
  const militaryId = createPersonId('pe', 3)
  const advisorId = createPersonId('pe', 4)
  const provinceId = createProvinceId('p', 0)

  let state = makeEmptyV016State()
  state = withHouse(state, houseId, {
    nameKey: 'Test House',
    memberIds: [leaderId, adminId, treasurerId, militaryId, advisorId],
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, {
    ownerHouseId: houseId,
    rank: 2,
    active: true,
    capitalProvinceId: provinceId,
  })
  state = withProvince(state, provinceId, { nameKey: 'Test Province' })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  state = withPerson(state, leaderId, { nameKey: 'Leader', houseId })
  state = withPerson(state, adminId, { nameKey: 'Administrator', houseId })
  state = withPerson(state, treasurerId, { nameKey: 'Treasurer', houseId })
  state = withPerson(state, militaryId, { nameKey: 'Military', houseId })
  state = withPerson(state, advisorId, { nameKey: 'Advisor', houseId })

  return {
    state,
    config: defaultConfig,
    polityId,
    houseId,
    leaderId,
    adminId,
    treasurerId,
    militaryId,
    advisorId,
    provinceId,
  }
}

describe('getEffectiveOfficeMaxHolders', () => {
  it('returns 1 for house non-leader role', () => {
    const { state, config, houseId } = makeFixture()
    const result = getEffectiveOfficeMaxHolders(
      state,
      config,
      { kind: 'house', id: houseId },
      'administrator',
    )
    expect(result).toBe(1)
  })

  it('returns baseMax for polity leader role', () => {
    const { state, config, polityId } = makeFixture()
    const result = getEffectiveOfficeMaxHolders(
      state,
      config,
      { kind: 'polity', id: polityId },
      'leader',
    )
    const def = OFFICE_DEFINITIONS['polity:leader']
    expect(result).toBe(def.maxHolders)
  })

  it('applies province factor for polity non-leader roles', () => {
    const { state, config, polityId } = makeFixture()
    // polity has 1 province (small)
    const result = getEffectiveOfficeMaxHolders(
      state,
      config,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    const rankRow = defaultConfig.polityOfficeMaxByRank[2]
    const rankCap = rankRow.administrator
    const factor = defaultConfig.polityOfficeMaxProvinceFactor.small
    const expected = Math.max(1, Math.floor(rankCap * factor))
    expect(result).toBe(expected)
  })
})

describe('isOfficeTermExpired', () => {
  it('returns false for leader role', () => {
    const { state, config } = makeFixture()
    const assignment: OfficeAssignment = {
      id: createOfficeAssignmentId(0),
      organization: { kind: 'polity', id: createPolityId('c', 0) },
      role: 'leader',
      holderPersonId: createPersonId('pe', 0),
      active: true,
      startYear: 1400,
      unpaidCount: 0,
    }
    expect(isOfficeTermExpired(state, config, assignment)).toBe(false)
  })

  it('returns false when years elapsed < termYears', () => {
    const { state, config } = makeFixture()
    state.currentYear = 1450
    const assignment: OfficeAssignment = {
      id: createOfficeAssignmentId(0),
      organization: { kind: 'polity', id: createPolityId('c', 0) },
      role: 'administrator',
      holderPersonId: createPersonId('pe', 0),
      active: true,
      startYear: 1445,
      unpaidCount: 0,
    }
    const termYears = config.officeTermYears.polity.administrator
    expect(isOfficeTermExpired(state, config, assignment)).toBe(1450 - 1445 >= termYears)
  })

  it('returns true when years elapsed >= termYears', () => {
    const { state, config } = makeFixture()
    state.currentYear = 1500
    const assignment: OfficeAssignment = {
      id: createOfficeAssignmentId(0),
      organization: { kind: 'polity', id: createPolityId('c', 0) },
      role: 'administrator',
      holderPersonId: createPersonId('pe', 0),
      active: true,
      startYear: 1444,
      unpaidCount: 0,
    }
    expect(isOfficeTermExpired(state, config, assignment)).toBe(true)
  })
})

describe('getHousePolityOfficeOverlapScore', () => {
  it('returns 0 when no offices are held by anyone', () => {
    const { state, houseId, polityId } = makeFixture()
    const result = getHousePolityOfficeOverlapScore(state, houseId, polityId)
    expect(result).toBe(0)
  })

  it('returns 1 when all 5 pairs overlap', () => {
    let state = makeFixture().state
    const { houseId, polityId, leaderId, adminId, treasurerId, militaryId, advisorId } =
      makeFixture()
    // Create matching offices in both house and polity
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'leader', leaderId)
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'administrator', adminId)
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      adminId,
    )
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'treasurer', treasurerId)
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'treasurer',
      treasurerId,
    )
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'military', militaryId)
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'military', militaryId)
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'advisor', advisorId)
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'advisor', advisorId)

    const result = getHousePolityOfficeOverlapScore(state, houseId, polityId)
    expect(result).toBe(1)
  })

  it('returns partial score for partial overlap', () => {
    let state = makeFixture().state
    const { houseId, polityId, leaderId, adminId } = makeFixture()
    // Only leader and administrator overlap
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'leader', leaderId)
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', leaderId)
    state = createOfficeAssignment(state, { kind: 'house', id: houseId }, 'administrator', adminId)
    state = createOfficeAssignment(
      state,
      { kind: 'polity', id: polityId },
      'administrator',
      adminId,
    )

    const result = getHousePolityOfficeOverlapScore(state, houseId, polityId)
    // leader (4) + administrator (3) = 7 matched out of 13 total
    expect(result).toBe(7 / 13)
  })
})

describe('getOfficeCompatibilityPenalty', () => {
  it('returns 0 for person with no offices', () => {
    const { state, config, polityId } = makeFixture()
    const result = getOfficeCompatibilityPenalty(
      state,
      config,
      createPersonId('pe', 99),
      { kind: 'polity', id: polityId },
      'administrator',
    )
    expect(result).toBe(0)
  })

  it('returns reduced penalty for compatible pair with owner house', () => {
    const { state: s1, config, polityId } = makeFixture()
    const { houseId, adminId } = makeFixture()
    // The house is the owner of the polity, so share reduction = compatibleShareReductionMax
    const state = createOfficeAssignment(
      s1,
      { kind: 'house', id: houseId },
      'administrator',
      adminId,
    )

    const result = getOfficeCompatibilityPenalty(
      state,
      config,
      adminId,
      { kind: 'polity', id: polityId },
      'administrator',
    )
    // compatibleOfficePenalty * (1 - compatibleShareReductionMax) = 2 * (1 - 0.5) = 1
    expect(result).toBe(config.compatibleOfficePenalty * (1 - config.compatibleShareReductionMax))
  })

  it('returns full incompatibleOfficePenalty for incompatible pair', () => {
    const { state: s1, config, polityId } = makeFixture()
    const { houseId, adminId } = makeFixture()
    const state = createOfficeAssignment(
      s1,
      { kind: 'house', id: houseId },
      'administrator',
      adminId,
    )

    // Targeting military role (incompatible with administrator)
    const result = getOfficeCompatibilityPenalty(
      state,
      config,
      adminId,
      { kind: 'polity', id: polityId },
      'military',
    )
    expect(result).toBe(config.incompatibleOfficePenalty)
  })
})

// Ensure getActiveFactions and getFaction are still accessible (regression check)
describe('regression: existing selectors still exported', () => {
  it('getActiveFactions is a function', () => {
    const state = makeEmptyV016State()
    expect(typeof getActiveFactions).toBe('function')
    expect(getActiveFactions(state)).toEqual([])
  })

  it('getFaction is a function', () => {
    const state = makeEmptyV016State()
    expect(typeof getFaction).toBe('function')
    expect(getFaction(state, createFactionId(0))).toBeUndefined()
  })
})
