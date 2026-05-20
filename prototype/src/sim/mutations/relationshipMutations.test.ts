import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId } from '../types/ids'
import { collectIntegrityErrors } from '../tick/integritySystem'
import { setSpouse, clearSpouse, addChildToParents } from './relationshipMutations'
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
} {
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)
  const house1Id = createHouseId('h', 0)
  const polity1Id = createPolityId('c', 0)
  const provinceId = createProvinceId('p', 0)

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 75088 }
  state = withProvince(state, provinceId, { name: 'Test Province', development: 10 })
  state = withHouse(state, house1Id, {
    name: 'House 1',
    memberIds: [person1Id, person2Id],
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polity1Id, {
    name: 'Polity 1',
    ownerHouseId: house1Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polity1Id, house1Id)
  state = withPerson(state, person1Id, { name: 'Person 1', houseId: house1Id, legacyPrestige: 10 })
  state = withPerson(state, person2Id, {
    name: 'Person 2',
    sex: 'female',
    age: 28,
    houseId: house1Id,
    legacyPrestige: 10,
  })
  return { state, person1Id, person2Id, house1Id }
}

describe('setSpouse', () => {
  it('sets bidirectional spouseId on both persons', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const result = setSpouse(state, person1Id, person2Id)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.persons[person1Id]!.spouseId).toBe(person2Id)
      expect(result.value.persons[person2Id]!.spouseId).toBe(person1Id)
    }
  })

  it('returns err when personA not found', () => {
    const { state, person1Id } = makeFixture()
    const result = setSpouse(state, createPersonId('pe', 99), person1Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })

  it('returns err when personB not found', () => {
    const { state, person1Id } = makeFixture()
    const result = setSpouse(state, person1Id, createPersonId('pe', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })

  it('returns err when personA already has a spouse', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const first = setSpouse(state, person1Id, person2Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const result = setSpouse(first.value, person1Id, person2Id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTEGRITY_VIOLATION')
  })

  it('returns err when personB already has a spouse', () => {
    const { state, person1Id, person2Id, house1Id } = makeFixture()
    const first = setSpouse(state, person1Id, person2Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const person3Id = createPersonId('pe', 2)
    const stateWithPerson3: WorldState = {
      ...first.value,
      persons: {
        ...first.value.persons,
        [person3Id]: {
          id: person3Id,
          name: 'Person 3',
          sex: 'male' as const,
          age: 25,
          alive: true,
          houseId: house1Id,
          childIds: [],
          birthStatus: 'unknown' as const,
          abilities: DEFAULT_ABILITIES,
          aptitudes: DEFAULT_ABILITIES,
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
      },
    }
    const result = setSpouse(stateWithPerson3, person3Id, person2Id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INTEGRITY_VIOLATION')
  })
})

describe('clearSpouse', () => {
  it('clears spouseId from both persons', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const married = setSpouse(state, person1Id, person2Id)
    expect(married.ok).toBe(true)
    if (!married.ok) return

    const result = clearSpouse(married.value, person1Id)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.persons[person1Id]!.spouseId).toBeUndefined()
    expect(result.value.persons[person2Id]!.spouseId).toBeUndefined()
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('is a no-op when person has no spouse', () => {
    const { state, person1Id } = makeFixture()
    const result = clearSpouse(state, person1Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(state)
  })

  it('returns err when person not found', () => {
    const { state } = makeFixture()
    const result = clearSpouse(state, createPersonId('pe', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })
})

describe('addChildToParents', () => {
  it('adds child to father childIds', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const result = addChildToParents(state, person2Id, person1Id)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.persons[person1Id]!.childIds).toContain(person2Id)
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('adds child to mother childIds', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const result = addChildToParents(state, person1Id, undefined, person2Id)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.persons[person2Id]!.childIds).toContain(person1Id)
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('sets fatherId on child if not already set', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const result = addChildToParents(state, person2Id, person1Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.persons[person2Id]!.fatherId).toBe(person1Id)
  })

  it('does not duplicate child in parent childIds', () => {
    const { state, person1Id, person2Id } = makeFixture()
    const first = addChildToParents(state, person2Id, person1Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = addChildToParents(first.value, person2Id, person1Id)
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const childIds = second.value.persons[person1Id]!.childIds
    expect(childIds.filter((id) => (id as string) === (person2Id as string))).toHaveLength(1)
  })

  it('returns err when child not found', () => {
    const { state, person1Id } = makeFixture()
    const result = addChildToParents(state, createPersonId('pe', 99), person1Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })

  it('returns err when father not found', () => {
    const { state, person1Id } = makeFixture()
    const result = addChildToParents(state, person1Id, createPersonId('pe', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_NOT_FOUND')
  })
})
