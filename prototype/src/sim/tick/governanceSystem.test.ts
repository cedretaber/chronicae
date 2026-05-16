import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { RoleType } from '../types/role'
import type { TickContext } from './context'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { runGovernanceSystem } from './governanceSystem'

function makePerson(id: PersonId, admin: number): Person {
  return {
    id,
    name: 'Person-' + id,
    sex: 'male',
    age: 30,
    alive: true,
    houseId: 'h-0' as HouseId,
    countryId: 'c-0' as CountryId,
    childIds: [],
    birthStatus: 'unknown',
    stats: { admin, martial: 5 },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 10,
    attitudes: {},
  }
}

function makeCtx({
  chancellorId,
  treasurerId,
  treasury,
  rulerHousePrestige,
  currentMonth = 1,
}: {
  chancellorId?: PersonId
  treasurerId?: PersonId
  treasury: number
  rulerHousePrestige: number
  currentMonth?: number
}): TickContext {
  const countryId = createCountryId('c', 0)
  const houseId = createHouseId('h', 0)
  const chancellorPersonId = createPersonId('pe', 0)
  const treasurerPersonId = treasurerId ?? createPersonId('pe', 1)
  const headPersonId = createPersonId('pe', 2)

  const roleAssignments: Partial<Record<RoleType, PersonId>> = {}
  if (chancellorId !== undefined) {
    roleAssignments.chancellor = chancellorId
  }
  if (treasurerId !== undefined) {
    roleAssignments.treasurer = treasurerId
  }

  const persons: Record<PersonId, Person> = {}
  if (chancellorId !== undefined) {
    persons[chancellorId] = makePerson(chancellorId, 8)
  } else {
    persons[chancellorPersonId] = makePerson(chancellorPersonId, 8)
  }
  if (treasurerId !== undefined) {
    persons[treasurerId] = makePerson(treasurerId, 6)
  } else {
    persons[treasurerPersonId] = makePerson(treasurerPersonId, 6)
  }
  persons[headPersonId] = makePerson(headPersonId, 5)

  const state = {
    currentYear: 1,
    currentMonth,
    provinces: {},
    countries: {
      [countryId]: {
        id: countryId,
        name: 'C0',
        rulerHouseId: houseId,
        houseIds: [houseId],
        treasury,
        legacyPrestige: 50,
        adminPower: 30,
        roleAssignments,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [houseId]: {
        id: houseId,
        name: 'H0',
        active: true,
        countryId,
        provinceIds: [],
        memberIds: [headPersonId],
        headId: headPersonId,
        cadetHouseIds: [],
        legacyPrestige: rulerHousePrestige,
        wealth: 100,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons,
    activePlots: {},
    popGroups: {},
  }

  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
  }
}

describe('runGovernanceSystem', () => {
  it('updates adminPower on January (month 1)', () => {
    const chancellorId = createPersonId('pe', 0)
    const treasurerId = createPersonId('pe', 1)
    const ctx = makeCtx({
      chancellorId,
      treasurerId,
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 1,
    })

    const result = runGovernanceSystem(ctx)

    // Formula: 0.30*chancellorScore + 0.20*treasurerScore + 0.20*stability + 0.15*rulerPrestige + 0.15*treasuryScore
    // chancellorScore = 8*10 = 80, treasurerScore = 6*10 = 60
    // stability = 50 (no provinces → fallback), rulerPrestige = 40 (legacyPrestige, no explicit attitudes)
    // treasuryScore = clamp(log1p(200)*10, 0, 100) ≈ 53.03
    // adminPower ≈ 0.30*80 + 0.20*60 + 0.20*50 + 0.15*40 + 0.15*53.03 ≈ 59.95
    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBeCloseTo(59.95, 1)
  })

  it('does not update adminPower on other months', () => {
    const ctx = makeCtx({
      chancellorId: createPersonId('pe', 0),
      treasurerId: createPersonId('pe', 1),
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 2,
    })

    const result = runGovernanceSystem(ctx)

    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBe(30)
  })

  it('uses 50 for vacant chancellor', () => {
    const treasurerId = createPersonId('pe', 1)
    const ctx = makeCtx({
      treasurerId,
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 1,
    })

    const result = runGovernanceSystem(ctx)

    // chancellorScore = 50 (vacant), treasurerScore = 60, stability = 50, rulerPrestige = 40
    // treasuryScore ≈ 53.03
    // adminPower ≈ 0.30*50 + 0.20*60 + 0.20*50 + 0.15*40 + 0.15*53.03 ≈ 50.95
    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBeCloseTo(50.95, 1)
  })

  it('computes adminPower correctly with high-end inputs', () => {
    const ctx = makeCtx({
      chancellorId: createPersonId('pe', 0),
      treasurerId: createPersonId('pe', 1),
      treasury: 10000,
      rulerHousePrestige: 100,
      currentMonth: 1,
    })
    // Override persons with admin=10
    const person0 = makePerson(createPersonId('pe', 0), 10)
    const person1 = makePerson(createPersonId('pe', 1), 10)
    ctx.state.persons[createPersonId('pe', 0)] = person0
    ctx.state.persons[createPersonId('pe', 1)] = person1

    const result = runGovernanceSystem(ctx)

    // chancellorScore = 100, treasurerScore = 100, stability = 50, rulerPrestige = 100
    // treasuryScore = clamp(log1p(10000)*10, 0, 100) ≈ 92.10
    // adminPower ≈ 0.30*100 + 0.20*100 + 0.20*50 + 0.15*100 + 0.15*92.10 ≈ 88.82
    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBeCloseTo(88.82, 1)
    expect(country.adminPower).toBeLessThanOrEqual(100)
  })
})
