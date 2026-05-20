import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
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
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'

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
  polity1Id: PolityId
  polity2Id: PolityId
  province1Id: ProvinceId
  province2Id: ProvinceId
} {
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const polity1Id = createPolityId('c', 0)
  const polity2Id = createPolityId('c', 1)
  const province1Id = createProvinceId('p', 0)
  const province2Id = createProvinceId('p', 1)

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312 }
  state = withProvince(state, province1Id, { name: 'Test Province 1', development: 10 })
  state = withProvince(state, province2Id, { name: 'Test Province 2', x: 1, y: 1, development: 10 })
  state = withHouse(state, house1Id, {
    name: 'House 1',
    memberIds: [person1Id],
    seatProvinceId: province1Id,
  })
  state = withHouse(state, house2Id, {
    name: 'House 2',
    memberIds: [person2Id],
    seatProvinceId: province2Id,
  })
  state = withPolity(state, polity1Id, {
    name: 'Polity 1',
    ownerHouseId: house1Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: province1Id,
  })
  state = withPolity(state, polity2Id, {
    name: 'Polity 2',
    ownerHouseId: house2Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: province2Id,
  })
  state = bindProvinceToHouseViaPolity(state, province1Id, polity1Id, house1Id)
  state = bindProvinceToHouseViaPolity(state, province2Id, polity2Id, house2Id)
  state = withPerson(state, person1Id, { name: 'Person 1', houseId: house1Id, legacyPrestige: 10 })
  state = withPerson(state, person2Id, {
    name: 'Person 2',
    sex: 'female',
    age: 28,
    houseId: house2Id,
    legacyPrestige: 10,
  })
  return {
    state,
    person1Id,
    person2Id,
    house1Id,
    house2Id,
    polity1Id,
    polity2Id,
    province1Id,
    province2Id,
  }
}

describe('markPersonDead', () => {
  it('sets alive to false', () => {
    const { state, person1Id } = makeFixture()
    const result = markPersonDead(state, person1Id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person1Id]!.alive).toBe(false)
  })

  it('does not set deathCircumstance when no options given', () => {
    const { state, person1Id } = makeFixture()
    const result = markPersonDead(state, person1Id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person1Id]!.deathCircumstance).toBeUndefined()
  })

  it('sets deathCircumstance to natural when provided', () => {
    const { state, person1Id } = makeFixture()
    const result = markPersonDead(state, person1Id, { deathCircumstance: 'natural' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person1Id]!.deathCircumstance).toBe('natural')
  })

  it('sets deathCircumstance to faded_from_history when provided', () => {
    const { state, person1Id } = makeFixture()
    const result = markPersonDead(state, person1Id, { deathCircumstance: 'faded_from_history' })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.value.persons[person1Id]!.deathCircumstance).toBe('faded_from_history')
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
    nextPolityIndex: 10,
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
