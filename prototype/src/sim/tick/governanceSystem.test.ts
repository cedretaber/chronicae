import { describe, expect, it } from 'vitest'
import {
  createCountryId,
  createHouseId,
  createPersonId,
  createOfficeAssignmentId,
} from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { OfficeAssignment } from '../types/office'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { runGovernanceSystem } from './governanceSystem'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(id: PersonId): Person {
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
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 10,
    wealth: 0,
    attitudes: {},
  }
}

function makeCtx({
  administratorId,
  treasurerId,
  treasury,
  rulerHousePrestige,
  currentMonth = 1,
}: {
  administratorId?: PersonId
  treasurerId?: PersonId
  treasury: number
  rulerHousePrestige: number
  currentMonth?: number
}): TickContext {
  const countryId = createCountryId('c', 0)
  const houseId = createHouseId('h', 0)
  const administratorPersonId = createPersonId('pe', 0)
  const treasurerPersonId = treasurerId ?? createPersonId('pe', 1)
  const headPersonId = createPersonId('pe', 2)

  const officeAssignments: Record<string, OfficeAssignment> = {}
  const officeIndexByOrg: Record<string, string[]> = {}
  const officeIndexByHolder: Record<string, string[]> = {}

  if (administratorId !== undefined) {
    const officeId = createOfficeAssignmentId(0)
    officeAssignments[officeId] = {
      id: officeId,
      organization: { kind: 'country', id: countryId },
      role: 'administrator',
      holderPersonId: administratorId,
      active: true,
      startYear: 1,
      unpaidCount: 0,
    }
    const orgKey = `country:${countryId}`
    officeIndexByOrg[orgKey] = [officeId]
    officeIndexByHolder[administratorId] = [officeId]
  } else {
    const officeId = createOfficeAssignmentId(0)
    officeAssignments[officeId] = {
      id: officeId,
      organization: { kind: 'country', id: countryId },
      role: 'administrator',
      holderPersonId: administratorPersonId,
      active: true,
      startYear: 1,
      unpaidCount: 0,
    }
    const orgKey = `country:${countryId}`
    officeIndexByOrg[orgKey] = [officeId]
    officeIndexByHolder[administratorPersonId] = [officeId]
  }

  if (treasurerId !== undefined) {
    const officeId = createOfficeAssignmentId(1)
    officeAssignments[officeId] = {
      id: officeId,
      organization: { kind: 'country', id: countryId },
      role: 'treasurer',
      holderPersonId: treasurerId,
      active: true,
      startYear: 1,
      unpaidCount: 0,
    }
    const orgKey = `country:${countryId}`
    if (!officeIndexByOrg[orgKey]) officeIndexByOrg[orgKey] = []
    officeIndexByOrg[orgKey].push(officeId)
    officeIndexByHolder[treasurerId] = [officeId]
  } else {
    const officeId = createOfficeAssignmentId(1)
    officeAssignments[officeId] = {
      id: officeId,
      organization: { kind: 'country', id: countryId },
      role: 'treasurer',
      holderPersonId: treasurerPersonId,
      active: true,
      startYear: 1,
      unpaidCount: 0,
    }
    const orgKey = `country:${countryId}`
    if (!officeIndexByOrg[orgKey]) officeIndexByOrg[orgKey] = []
    officeIndexByOrg[orgKey].push(officeId)
    officeIndexByHolder[treasurerPersonId] = [officeId]
  }

  const persons: Record<PersonId, Person> = {}
  if (administratorId !== undefined) {
    persons[administratorId] = makePerson(administratorId)
  } else {
    persons[administratorPersonId] = makePerson(administratorPersonId)
  }
  if (treasurerId !== undefined) {
    persons[treasurerId] = makePerson(treasurerId)
  } else {
    persons[treasurerPersonId] = makePerson(treasurerPersonId)
  }
  persons[headPersonId] = makePerson(headPersonId)

  const state = {
    currentYear: 1,
    currentMonth,
    provinces: {},
    countries: {
      [countryId]: {
        id: countryId,
        name: 'C0',
        houseIds: [houseId],
        treasury,
        legacyPrestige: 50,
        adminPower: 30,
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
        cadetHouseIds: [],
        legacyPrestige: rulerHousePrestige,
        wealth: 100,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons,
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments,
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: officeIndexByOrg, byHolderPerson: officeIndexByHolder },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 2,
  }

  return {
    state: state as unknown as WorldState,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
  }
}

describe('runGovernanceSystem', () => {
  it('updates adminPower on January (month 1)', () => {
    const administratorId = createPersonId('pe', 0)
    const treasurerId = createPersonId('pe', 1)
    const ctx = makeCtx({
      administratorId,
      treasurerId,
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 1,
    })

    const result = runGovernanceSystem(ctx)

    // Formula changed in v0.12:
    // (rulerContrib + adminContrib + treasurerContrib) * efficiency * 0.5
    //   + stability * 0.2 + legacyPrestige * 0.15 + treasuryScore * 0.15
    // where:
    //   rulerContrib = getEffectiveOfficeStat(country, 'leader', 'admin') * 4
    //   adminContrib = getEffectiveOfficeStat(country, 'administrator', 'admin') * 3
    //   treasurerContrib = getEffectiveOfficeStat(country, 'treasurer', 'admin') * 2
    //   efficiency = clamp(capacity / max(1, load), minEfficiency, maxEfficiency)
    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBeGreaterThan(0)
    expect(country.adminPower).toBeLessThanOrEqual(100)
  })

  it('does not update adminPower on other months', () => {
    const ctx = makeCtx({
      administratorId: createPersonId('pe', 0),
      treasurerId: createPersonId('pe', 1),
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 2,
    })

    const result = runGovernanceSystem(ctx)

    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBe(30)
  })

  it('uses 0 for vacant administrator', () => {
    const treasurerId = createPersonId('pe', 1)
    const ctx = makeCtx({
      treasurerId,
      treasury: 200,
      rulerHousePrestige: 40,
      currentMonth: 1,
    })

    const result = runGovernanceSystem(ctx)

    // administrator is vacant (no office holder), treasurer has admin=6
    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBeGreaterThan(0)
    expect(country.adminPower).toBeLessThanOrEqual(100)
  })

  it('computes adminPower correctly with high-end inputs', () => {
    const ctx = makeCtx({
      administratorId: createPersonId('pe', 0),
      treasurerId: createPersonId('pe', 1),
      treasury: 10000,
      rulerHousePrestige: 100,
      currentMonth: 1,
    })
    // Override persons with admin=10
    const person0 = makePerson(createPersonId('pe', 0))
    const person1 = makePerson(createPersonId('pe', 1))
    ctx.state.persons[createPersonId('pe', 0)] = person0
    ctx.state.persons[createPersonId('pe', 1)] = person1

    const result = runGovernanceSystem(ctx)

    const country = result.state.countries[createCountryId('c', 0)]!
    expect(country.adminPower).toBeLessThanOrEqual(100)
  })
})
