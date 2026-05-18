import { describe, expect, it } from 'vitest'
import { createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PersonId } from '../types/ids'
import type { Person } from '../types/person'
import type { WorldState } from '../types/world'
import { isForbiddenMarriagePair } from './kinshipSelectors'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(overrides: Partial<Person> = {}): Person {
  const id = overrides.id ?? createPersonId('pe', 0)
  const houseId = overrides.houseId ?? createHouseId('h', 0)
  return {
    id,
    name: 'Person',
    sex: 'male',
    age: 30,
    alive: true,
    houseId,
    childIds: [],
    birthStatus: 'unknown',
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 50,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
}

function makeState(persons: Record<PersonId, Person>): WorldState {
  const firstHouseId = Object.values(persons)[0]?.houseId ?? createHouseId('h', 0)
  return {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {},
    polities: {},
    houses: {
      [firstHouseId]: {
        id: firstHouseId,
        name: 'House',
        active: true,
        provinceIds: [],
        memberIds: Object.values(persons).map((p) => p.id),
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: createProvinceId('p', 0),
      },
    },
    persons,
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  }
}

describe('isForbiddenMarriagePair', () => {
  it('returns true when a is parent of b (a.childIds contains b.id)', () => {
    const child = makePerson({ id: createPersonId('pe', 1), childIds: [] })
    const parent = makePerson({
      id: createPersonId('pe', 0),
      childIds: [child.id],
    })
    const state = makeState({ [parent.id]: parent, [child.id]: child })
    expect(isForbiddenMarriagePair(parent, child, state)).toBe(true)
  })

  it('returns true when b is parent of a (b.childIds contains a.id)', () => {
    const child = makePerson({ id: createPersonId('pe', 0), childIds: [] })
    const parent = makePerson({
      id: createPersonId('pe', 1),
      childIds: [child.id],
    })
    const state = makeState({ [parent.id]: parent, [child.id]: child })
    expect(isForbiddenMarriagePair(parent, child, state)).toBe(true)
  })

  it('returns true for siblings with same father', () => {
    const fatherId = createPersonId('pe', 0)
    const sibling1 = makePerson({ id: createPersonId('pe', 1), fatherId, childIds: [] })
    const sibling2 = makePerson({ id: createPersonId('pe', 2), fatherId, childIds: [] })
    const state = makeState({ [sibling1.id]: sibling1, [sibling2.id]: sibling2 })
    expect(isForbiddenMarriagePair(sibling1, sibling2, state)).toBe(true)
  })

  it('returns true for siblings with same mother', () => {
    const motherId = createPersonId('pe', 0)
    const sibling1 = makePerson({ id: createPersonId('pe', 1), motherId, childIds: [] })
    const sibling2 = makePerson({ id: createPersonId('pe', 2), motherId, childIds: [] })
    const state = makeState({ [sibling1.id]: sibling1, [sibling2.id]: sibling2 })
    expect(isForbiddenMarriagePair(sibling1, sibling2, state)).toBe(true)
  })

  it('returns true when a is grandparent of b', () => {
    const grandchild = makePerson({ id: createPersonId('pe', 2), childIds: [] })
    const child = makePerson({
      id: createPersonId('pe', 1),
      fatherId: createPersonId('pe', 0),
      childIds: [grandchild.id],
    })
    const grandparent = makePerson({
      id: createPersonId('pe', 0),
      childIds: [child.id],
    })
    const state = makeState({
      [grandparent.id]: grandparent,
      [child.id]: child,
      [grandchild.id]: grandchild,
    })
    expect(isForbiddenMarriagePair(grandparent, grandchild, state)).toBe(true)
  })

  it('returns true when b is grandparent of a', () => {
    const grandchild = makePerson({ id: createPersonId('pe', 0), childIds: [] })
    const child = makePerson({
      id: createPersonId('pe', 1),
      motherId: createPersonId('pe', 2),
      childIds: [grandchild.id],
    })
    const grandparent = makePerson({
      id: createPersonId('pe', 2),
      childIds: [child.id],
    })
    const state = makeState({
      [grandchild.id]: grandchild,
      [child.id]: child,
      [grandparent.id]: grandparent,
    })
    expect(isForbiddenMarriagePair(grandchild, grandparent, state)).toBe(true)
  })

  it('returns false for unrelated persons', () => {
    const a = makePerson({ id: createPersonId('pe', 0), childIds: [] })
    const b = makePerson({ id: createPersonId('pe', 1), childIds: [] })
    const state = makeState({ [a.id]: a, [b.id]: b })
    expect(isForbiddenMarriagePair(a, b, state)).toBe(false)
  })

  it('returns false for cousins (same grandfather but different parents)', () => {
    const grandfatherId = createPersonId('pe', 0)
    const uncle = makePerson({
      id: createPersonId('pe', 1),
      fatherId: grandfatherId,
      childIds: [],
    })
    const aunt = makePerson({
      id: createPersonId('pe', 2),
      fatherId: grandfatherId,
      childIds: [],
    })
    const cousin1 = makePerson({
      id: createPersonId('pe', 3),
      fatherId: uncle.id,
      childIds: [],
    })
    const cousin2 = makePerson({
      id: createPersonId('pe', 4),
      fatherId: aunt.id,
      childIds: [],
    })
    const state = makeState({
      [grandfatherId]: makePerson({ id: grandfatherId, childIds: [uncle.id, aunt.id] }),
      [uncle.id]: uncle,
      [aunt.id]: aunt,
      [cousin1.id]: cousin1,
      [cousin2.id]: cousin2,
    })
    expect(isForbiddenMarriagePair(cousin1, cousin2, state)).toBe(false)
  })
})
