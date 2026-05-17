import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { collectIntegrityErrors } from '../tick/integritySystem'
import {
  movePersonToHouse,
  birthChild,
  markPersonDead,
  addPersonWealth,
  clearPersonWealth,
} from './personMutations'
import { setSpouse } from './relationshipMutations'
import { createOfficeAssignment } from './officeMutations'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeFixture(): {
  state: WorldState
  person1Id: PersonId
  person2Id: PersonId
  house1Id: HouseId
  house2Id: HouseId
  country1Id: CountryId
  country2Id: CountryId
} {
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const country1Id = createCountryId('c', 0)
  const country2Id = createCountryId('c', 1)

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    countries: {
      [country1Id]: {
        id: country1Id,
        name: 'Country 1',
        houseIds: [house1Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
      [country2Id]: {
        id: country2Id,
        name: 'Country 2',
        houseIds: [house2Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        name: 'House 1',
        active: true,
        countryId: country1Id,
        provinceIds: [],
        memberIds: [person1Id],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
      [house2Id]: {
        id: house2Id,
        name: 'House 2',
        active: true,
        countryId: country2Id,
        provinceIds: [],
        memberIds: [person2Id],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [person1Id]: {
        id: person1Id,
        name: 'Person 1',
        sex: 'male' as const,
        age: 30,
        alive: true,
        houseId: house1Id,
        countryId: country1Id,
        childIds: [],
        birthStatus: 'legitimate' as const,
        abilities: DEFAULT_ABILITIES,
        aptitudes: DEFAULT_ABILITIES,
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 10,
        wealth: 0,
        attitudes: {},
      },
      [person2Id]: {
        id: person2Id,
        name: 'Person 2',
        sex: 'female' as const,
        age: 28,
        alive: true,
        houseId: house2Id,
        countryId: country2Id,
        childIds: [],
        birthStatus: 'legitimate' as const,
        abilities: DEFAULT_ABILITIES,
        aptitudes: DEFAULT_ABILITIES,
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 10,
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
    person1Id,
    person2Id,
    house1Id,
    house2Id,
    country1Id,
    country2Id,
  }
}

describe('markPersonDead', () => {
  it('sets alive to false', () => {
    const { state, person1Id } = makeFixture()
    const result = markPersonDead(state, person1Id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person1Id]!.alive).toBe(false)
  })

  it('clears spouse relationship on both sides', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const withSpouse = setSpouse(state, person1Id, person2Id)
    expect(withSpouse.ok).toBe(true)
    if (!withSpouse.ok) return
    const result = markPersonDead(withSpouse.value, person1Id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[person1Id]!.spouseId).toBeUndefined()
    expect(result.value.persons[person2Id]!.spouseId).toBeUndefined()
  })

  it('revokes active office assignments', () => {
    const { state, person1Id, house1Id } = makeFixture()
    const withOffice = createOfficeAssignment(
      state,
      { kind: 'house', id: house1Id },
      'leader',
      person1Id,
    )
    expect(Object.keys(withOffice.officeAssignments).length).toBe(1)
    const result = markPersonDead(withOffice, person1Id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const assignments = Object.values(result.value.officeAssignments)
    expect(assignments.every((a) => !a.active)).toBe(true)
  })

  it('is a no-op when person is already dead', () => {
    const { state, person1Id } = makeFixture()
    const first = markPersonDead(state, person1Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = markPersonDead(first.value, person1Id)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value).toBe(first.value)
  })

  it('returns PERSON_NOT_FOUND for unknown personId', () => {
    const { state } = makeFixture()
    const result = markPersonDead(state, createPersonId('pe', 99))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })

  it('passes integrity check after death', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const withSpouse = setSpouse(state, person1Id, person2Id)
    expect(withSpouse.ok).toBe(true)
    if (!withSpouse.ok) return
    const result = markPersonDead(withSpouse.value, person1Id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })
})

describe('movePersonToHouse', () => {
  it('updates person.houseId to newHouseId', () => {
    const { state, person1Id, house2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person1Id]!.houseId).toBe(house2Id)
  })

  it('updates person.countryId to newHouse.countryId', () => {
    const { state, person1Id, house2Id, country2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person1Id]!.countryId).toBe(country2Id)
  })

  it('removes personId from old house memberIds', () => {
    const { state, person1Id, house1Id, house2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.houses[house1Id]!.memberIds).not.toContain(person1Id)
  })

  it('adds personId to new house memberIds', () => {
    const { state, person1Id, house2Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.houses[house2Id]!.memberIds).toContain(person1Id)
  })

  it('returns same state value when source and target house are the same (no-op)', () => {
    const { state, person1Id, house1Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, house1Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(state)
  })

  it('returns err when person not found', () => {
    const { state } = makeFixture()
    const result = movePersonToHouse(state, createPersonId('pe', 99), createHouseId('h', 0))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })

  it('returns err when target house not found', () => {
    const { state, person1Id } = makeFixture()
    const result = movePersonToHouse(state, person1Id, createHouseId('h', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextCountryIndex: 10,
  }
}

describe('birthChild', () => {
  it('creates a new person in father house', () => {
    const { state, person1Id, house1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = birthChild(ctx, {
      fatherId: person1Id,
      birthStatus: 'illegitimate',
      name: 'Child',
      sex: 'male',
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.6, caution: 0.4 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { childId } = result.value.value
    const newState = result.value.ctx.state
    const child = newState.persons[childId]
    expect(child).toBeDefined()
    expect(child!.name).toBe('Child')
    expect(child!.houseId).toBe(house1Id)
    expect(child!.fatherId).toBe(person1Id)
    expect(child!.age).toBe(0)
    expect(collectIntegrityErrors(newState)).toEqual([])
  })

  it('adds child to father childIds', () => {
    const { state, person1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = birthChild(ctx, {
      fatherId: person1Id,
      birthStatus: 'illegitimate',
      name: 'Child',
      sex: 'female',
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { childId } = result.value.value
    const newState = result.value.ctx.state
    expect(newState.persons[person1Id]!.childIds).toContain(childId)
  })

  it('adds child to house memberIds', () => {
    const { state, person1Id, house1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = birthChild(ctx, {
      fatherId: person1Id,
      birthStatus: 'illegitimate',
      name: 'Child',
      sex: 'male',
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { childId } = result.value.value
    const newState = result.value.ctx.state
    expect(newState.houses[house1Id]!.memberIds).toContain(childId)
  })

  it('sets motherId and adds child to mother childIds when motherId given', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = birthChild(ctx, {
      fatherId: person1Id,
      motherId: person2Id,
      birthStatus: 'legitimate',
      name: 'Child',
      sex: 'female',
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { childId } = result.value.value
    const newState = result.value.ctx.state
    expect(newState.persons[childId]!.motherId).toBe(person2Id)
    expect(newState.persons[person2Id]!.childIds).toContain(childId)
  })

  it('allocates a unique pe- prefixed personId', () => {
    const { state, person1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = birthChild(ctx, {
      fatherId: person1Id,
      birthStatus: 'illegitimate',
      name: 'Child',
      sex: 'male',
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { childId } = result.value.value
    expect((childId as string).startsWith('pe-')).toBe(true)
  })

  it('returns err when father not found', () => {
    const { state } = makeFixture()
    const ctx = makeCtx(state)
    const result = birthChild(ctx, {
      fatherId: createPersonId('pe', 99),
      birthStatus: 'illegitimate',
      name: 'Child',
      sex: 'male',
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })
})

describe('addPersonWealth', () => {
  it('adds delta to person wealth', () => {
    const { state, person1Id } = makeFixture()
    const result = addPersonWealth(state, person1Id, 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[person1Id]!.wealth).toBe(50)
  })

  it('floors at 0 for negative delta larger than wealth', () => {
    const { state, person1Id } = makeFixture()
    const result = addPersonWealth(state, person1Id, -100)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[person1Id]!.wealth).toBe(0)
  })

  it('returns err when person not found', () => {
    const { state } = makeFixture()
    const result = addPersonWealth(state, createPersonId('pe', 99), 10)
    expect(result.ok).toBe(false)
  })
})

describe('clearPersonWealth', () => {
  it('sets person wealth to 0', () => {
    const { state, person1Id } = makeFixture()
    const withWealth = addPersonWealth(state, person1Id, 100)
    expect(withWealth.ok).toBe(true)
    if (!withWealth.ok) return

    const result = clearPersonWealth(withWealth.value, person1Id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[person1Id]!.wealth).toBe(0)
  })

  it('returns err when person not found', () => {
    const { state } = makeFixture()
    const result = clearPersonWealth(state, createPersonId('pe', 99))
    expect(result.ok).toBe(false)
  })
})
