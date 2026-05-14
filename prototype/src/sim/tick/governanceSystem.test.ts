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
    traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
    prestige: 10,
  }
}

function makeCtx({
  chancellorId,
  treasurerId,
  stability,
  treasury,
  rulerHousePrestige,
  currentMonth = 1,
}: {
  chancellorId?: PersonId
  treasurerId?: PersonId
  stability: number
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
        legitimacy: 70,
        adminPower: 30,
        stability,
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
        prestige: rulerHousePrestige,
        cohesion: 60,
        loyaltyToCountry: 70,
        wealth: 100,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons,
    activePlots: {},
  }

  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
  }
}

describe('runGovernanceSystem', () => {
  it('updates adminPower on January (month 1)', () => {
    const chancellorId = createPersonId('pe', 0)
    const treasurerId = createPersonId('pe', 1)
    const ctx = makeCtx({
      chancellorId,
      treasurerId,
      stability: 60,
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 1,
    })

    const result = runGovernanceSystem(ctx)

    // Expected: clamp100(30 + 8*3 + 6*2 + 60*0.2 + 40*0.1 + clamp(200/100, 0, 10))
    // = clamp100(30 + 24 + 12 + 12 + 4 + 2) = clamp100(84) = 84
    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBe(84)
  })

  it('does not update adminPower on other months', () => {
    const ctx = makeCtx({
      chancellorId: createPersonId('pe', 0),
      treasurerId: createPersonId('pe', 1),
      stability: 60,
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 2,
    })

    const result = runGovernanceSystem(ctx)

    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBe(30)
  })

  it('uses 0 for vacant chancellor', () => {
    const treasurerId = createPersonId('pe', 1)
    const ctx = makeCtx({
      treasurerId,
      stability: 60,
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 1,
    })

    const result = runGovernanceSystem(ctx)

    // Expected: clamp100(30 + 0*3 + 6*2 + 60*0.2 + 40*0.1 + clamp(200/100, 0, 10))
    // = clamp100(30 + 0 + 12 + 12 + 4 + 2) = clamp100(60) = 60
    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBe(60)
  })

  it('caps adminPower at 100', () => {
    const ctx = makeCtx({
      chancellorId: createPersonId('pe', 0),
      treasurerId: createPersonId('pe', 1),
      stability: 100,
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

    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBe(100)
  })
})
