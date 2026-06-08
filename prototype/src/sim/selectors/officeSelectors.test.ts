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
  getHouseDecisionMaker,
} from './officeSelectors'
import { createHouseShare } from '../mutations/shareMutations'
import { getActiveFactions, getFaction } from './factionSelectors'
import { OFFICE_DEFINITIONS } from '../config/officeDefinitions'
import {
  makeEmptyV016State,
  withPerson,
  withHouse,
  withPolity,
  withProvince,
  withHouseLeader,
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
      slotIndex: 0,
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
      slotIndex: 0,
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
      slotIndex: 0,
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

// 影響力個人中心化 Phase 3a: 家の意志決定者 = 支配 share 保有者 (当主 fallback)
describe('getHouseDecisionMaker (Phase 3a)', () => {
  const houseId = createHouseId('h', 0)
  const leader = createPersonId('pe', 0)
  const heavy = createPersonId('pe', 1) // 支配 share
  const light = createPersonId('pe', 2)

  function base(): WorldState {
    let s = makeEmptyV016State()
    s = withHouse(s, houseId, { nameKey: 'H0', memberIds: [leader, heavy, light] })
    s = withPerson(s, leader, { nameKey: 'L', houseId })
    s = withPerson(s, heavy, { nameKey: 'Heavy', houseId })
    s = withPerson(s, light, { nameKey: 'Light', houseId })
    s = withHouseLeader(s, houseId, leader)
    return s
  }

  it('支配 share (max rawPower) 保有者を返す', () => {
    let s = base()
    s = createHouseShare(s, houseId, leader, 10)
    s = createHouseShare(s, houseId, heavy, 50)
    s = createHouseShare(s, houseId, light, 5)
    expect(getHouseDecisionMaker(s, houseId)).toBe(heavy)
  })

  it('share が無ければ当主 fallback', () => {
    const s = base()
    expect(getHouseDecisionMaker(s, houseId)).toBe(leader)
  })

  it('死亡 holder の share は無視する', () => {
    let s = base()
    s = createHouseShare(s, houseId, heavy, 50)
    s = { ...s, persons: { ...s.persons, [heavy]: { ...s.persons[heavy]!, alive: false } } }
    s = createHouseShare(s, houseId, light, 5)
    // heavy は死亡 → light が生存 holder の最大
    expect(getHouseDecisionMaker(s, houseId)).toBe(light)
  })

  it('同 rawPower は holderPersonId 昇順で安定 (heavy=pe-1 < light=pe-2)', () => {
    let s = base()
    s = createHouseShare(s, houseId, heavy, 20)
    s = createHouseShare(s, houseId, light, 20)
    expect(getHouseDecisionMaker(s, houseId)).toBe(heavy)
  })
})
