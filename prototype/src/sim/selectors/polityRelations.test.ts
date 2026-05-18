import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { Polity } from '../types/polity'
import type { House } from '../types/house'
import type { Person } from '../types/person'
import type { Province } from '../types/province'
import type { WorldState } from '../types/world'
import {
  getHousePolityIds,
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getHouseSeatProvinceInPolity,
  getPersonPrimaryPolityId,
  getPersonRelevantPolityIds,
  getPolityHouseIds,
  getPolityPersonIds,
  getPolityProvinceIds,
  getProvinceOwnerHouse,
  getProvincePolity,
} from './polityRelations'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeProvince(overrides: Partial<Province> & { id: ProvinceId }): Province {
  return {
    name: 'P',
    x: 0,
    y: 0,
    neighbors: [],
    habitability: 50,
    development: 1,
    polityControl: 100,
    popGroupIds: [],
    ...overrides,
  }
}

function makePolity(overrides: Partial<Polity> & { id: PolityId }): Polity {
  return {
    name: 'C',
    rank: 2,
    ownerHouseId: createHouseId('h', 0),
    treasury: 0,
    adminPower: 0,
    legacyPrestige: 0,
    active: true,
    capitalProvinceId: createProvinceId('pr', 0),
    ...overrides,
  }
}

function makeHouse(overrides: Partial<House> & { id: HouseId }): House {
  return {
    name: 'H',
    active: true,
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: createProvinceId('pr', 0),
    ...overrides,
  }
}

function makePerson(overrides: Partial<Person> & { id: PersonId }): Person {
  return {
    name: 'P',
    sex: 'male',
    age: 30,
    alive: true,
    houseId: createHouseId('h', 0),
    childIds: [],
    birthStatus: 'legitimate',
    abilities: { ...DEFAULT_ABILITIES },
    aptitudes: { ...DEFAULT_ABILITIES },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
}

function emptyState(): WorldState {
  return {
    currentYear: 1000,
    currentMonth: 1,
    provinces: {},
    polities: {},
    houses: {},
    persons: {},
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    landContracts: {},
    provinceOfficeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
    provinceTerminalPolityCache: {},
    provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
    polityIndex: { byOwnerHouse: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextProvinceOfficeAssignmentId: 0,
  }
}

describe('polityRelations - basic Province/Polity', () => {
  it('getProvincePolity returns the polity for the province', () => {
    const cid = createPolityId('c', 1)
    const pid = createProvinceId('pr', 1)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.provinces[pid] = makeProvince({ id: pid })

    expect(getProvincePolity(state, pid)?.id).toBe(cid)
  })

  it('getProvincePolity returns undefined for non-existent province', () => {
    const state = emptyState()
    const missing = createProvinceId('pr', 99)
    expect(getProvincePolity(state, missing)).toBeUndefined()
  })

  it('getProvinceOwnerHouse returns the owner house', () => {
    const hid = createHouseId('h', 1)
    const pid = createProvinceId('pr', 1)
    const state = emptyState()
    state.houses[hid] = makeHouse({ id: hid })
    state.provinces[pid] = makeProvince({ id: pid })

    expect(getProvinceOwnerHouse(state, pid)?.id).toBe(hid)
  })
})

describe('polityRelations - getPolityProvinceIds', () => {
  it('returns provinces in the polity sorted ascending', () => {
    const cid = createPolityId('c', 1)
    const otherCid = createPolityId('c', 2)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.polities[otherCid] = makePolity({ id: otherCid })
    const pids = [createProvinceId('pr', 3), createProvinceId('pr', 1), createProvinceId('pr', 2)]
    state.provinces[pids[0]!] = makeProvince({ id: pids[0]! })
    state.provinces[pids[1]!] = makeProvince({ id: pids[1]! })
    state.provinces[pids[2]!] = makeProvince({ id: pids[2]! })

    const result = getPolityProvinceIds(state, cid)
    expect(result.map((id) => id as string)).toEqual(['pr-1', 'pr-3'])
  })

  it('returns empty list for polity with no provinces', () => {
    const cid = createPolityId('c', 1)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })

    expect(getPolityProvinceIds(state, cid)).toEqual([])
  })
})

describe('polityRelations - getPolityHouseIds', () => {
  it('returns active houses with provinces in the polity, sorted', () => {
    const cid = createPolityId('c', 1)
    const h1 = createHouseId('h', 2)
    const h2 = createHouseId('h', 1)
    const inactive = createHouseId('h', 3)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.houses[h1] = makeHouse({ id: h1 })
    state.houses[h2] = makeHouse({ id: h2 })
    state.houses[inactive] = makeHouse({ id: inactive, active: false })
    state.provinces[createProvinceId('pr', 1)] = makeProvince({
      id: createProvinceId('pr', 1),
    })
    state.provinces[createProvinceId('pr', 2)] = makeProvince({
      id: createProvinceId('pr', 2),
    })
    state.provinces[createProvinceId('pr', 3)] = makeProvince({
      id: createProvinceId('pr', 3),
    })

    const result = getPolityHouseIds(state, cid)
    expect(result.map((id) => id as string)).toEqual(['h-1', 'h-2'])
  })

  it('deduplicates houses that own multiple provinces in the polity', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.houses[hid] = makeHouse({ id: hid })
    state.provinces[createProvinceId('pr', 1)] = makeProvince({
      id: createProvinceId('pr', 1),
    })
    state.provinces[createProvinceId('pr', 2)] = makeProvince({
      id: createProvinceId('pr', 2),
    })

    expect(getPolityHouseIds(state, cid)).toEqual([hid])
  })
})

describe('polityRelations - getPolityPersonIds', () => {
  it('returns alive members of polity houses, including duplicates across polities', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const alive = createPersonId('pe', 1)
    const dead = createPersonId('pe', 2)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.houses[hid] = makeHouse({ id: hid, memberIds: [alive, dead] })
    state.provinces[createProvinceId('pr', 1)] = makeProvince({
      id: createProvinceId('pr', 1),
    })
    state.persons[alive] = makePerson({ id: alive, houseId: hid, alive: true })
    state.persons[dead] = makePerson({ id: dead, houseId: hid, alive: false })

    expect(getPolityPersonIds(state, cid)).toEqual([alive])
  })
})

describe('polityRelations - House -> Polity', () => {
  it('getHousePolityIds returns active polities the house owns provinces in', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const inactiveC = createPolityId('c', 3)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.polities[c2] = makePolity({ id: c2 })
    state.polities[inactiveC] = makePolity({ id: inactiveC, active: false })
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: p1 })
    state.provinces[p1] = makeProvince({ id: p1 })
    state.provinces[p2] = makeProvince({ id: p2 })
    state.provinces[p3] = makeProvince({ id: p3 })

    const result = getHousePolityIds(state, hid)
    expect(result.map((id) => id as string)).toEqual(['c-1', 'c-2'])
  })

  it('getHousePolityIds returns empty for inactive house', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const pid = createProvinceId('pr', 1)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.houses[hid] = makeHouse({ id: hid, active: false })
    state.provinces[pid] = makeProvince({ id: pid })

    expect(getHousePolityIds(state, hid)).toEqual([])
  })

  it('getHouseProvinceIdsByPolity filters house provinces by polity', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.polities[c2] = makePolity({ id: c2 })
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: p1 })
    state.provinces[p1] = makeProvince({ id: p1 })
    state.provinces[p2] = makeProvince({ id: p2 })
    state.provinces[p3] = makeProvince({ id: p3 })

    expect(getHouseProvinceIdsByPolity(state, hid, c1).map((id) => id as string)).toEqual([
      'pr-1',
      'pr-2',
    ])
    expect(getHouseProvinceIdsByPolity(state, hid, c2).map((id) => id as string)).toEqual(['pr-3'])
  })
})

describe('polityRelations - getHousePrimaryPolityId', () => {
  it('returns the polity of seatProvinceId when house owns province there', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const seat = createProvinceId('pr', 1)
    const other = createProvinceId('pr', 2)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.polities[c2] = makePolity({ id: c2 })
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: seat })
    state.provinces[seat] = makeProvince({ id: seat })
    state.provinces[other] = makeProvince({ id: other })

    expect(getHousePrimaryPolityId(state, hid)).toBe(c1)
  })

  it('falls back to polity with most provinces when seat is in a polity house no longer owns', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const seat = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.polities[c2] = makePolity({ id: c2 })
    // seat は別家に奪われた状態
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: seat })
    state.provinces[seat] = makeProvince({
      id: seat,
    })
    state.provinces[p2] = makeProvince({ id: p2 })
    state.provinces[p3] = makeProvince({ id: p3 })

    expect(getHousePrimaryPolityId(state, hid)).toBe(c2)
  })

  it('returns undefined for inactive house or empty provinceIds', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.houses[hid] = makeHouse({ id: hid, active: false })

    expect(getHousePrimaryPolityId(state, hid)).toBeUndefined()
  })

  it('breaks ties by development sum, then by polity id ascending', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.polities[c2] = makePolity({ id: c2 })
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: p1 })
    // 同じ Province 数なら development の大きい c2 が選ばれる
    state.provinces[p1] = makeProvince({ id: p1, development: 1 })
    state.provinces[p2] = makeProvince({ id: p2, development: 5 })

    // seat (p1) は house が所有しているので、seat の polity = c1 が優先される（規則 1）
    expect(getHousePrimaryPolityId(state, hid)).toBe(c1)
  })
})

describe('polityRelations - Person -> Polity', () => {
  it('getPersonRelevantPolityIds delegates to the person house', () => {
    const c1 = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const personId = createPersonId('pe', 1)
    const p1 = createProvinceId('pr', 1)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: p1 })
    state.provinces[p1] = makeProvince({ id: p1 })
    state.persons[personId] = makePerson({ id: personId, houseId: hid })

    expect(getPersonRelevantPolityIds(state, personId)).toEqual([c1])
    expect(getPersonPrimaryPolityId(state, personId)).toBe(c1)
  })

  it('returns empty / undefined for missing person', () => {
    const state = emptyState()
    const missing = createPersonId('pe', 99)
    expect(getPersonRelevantPolityIds(state, missing)).toEqual([])
    expect(getPersonPrimaryPolityId(state, missing)).toBeUndefined()
  })
})

describe('polityRelations - getHouseSeatProvinceInPolity', () => {
  it('returns the actual seatProvinceId when it lies in the target polity and is owned by the house', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const seat = createProvinceId('pr', 1)
    const state = emptyState()
    state.polities[cid] = makePolity({ id: cid })
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: seat })
    state.provinces[seat] = makeProvince({ id: seat })

    expect(getHouseSeatProvinceInPolity(state, hid, cid)).toBe(seat)
  })

  it('picks the province with highest development when seat is not in the target polity', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const seat = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.polities[c2] = makePolity({ id: c2 })
    state.houses[hid] = makeHouse({
      id: hid,
      seatProvinceId: seat,
    })
    state.provinces[seat] = makeProvince({ id: seat })
    state.provinces[p2] = makeProvince({ id: p2, development: 3 })
    state.provinces[p3] = makeProvince({ id: p3, development: 7 })

    expect(getHouseSeatProvinceInPolity(state, hid, c2)).toBe(p3)
  })

  it('returns undefined when the house has no provinces in the polity', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const state = emptyState()
    state.polities[c1] = makePolity({ id: c1 })
    state.polities[c2] = makePolity({ id: c2 })
    state.houses[hid] = makeHouse({ id: hid, seatProvinceId: p1 })
    state.provinces[p1] = makeProvince({ id: p1 })

    expect(getHouseSeatProvinceInPolity(state, hid, c2)).toBeUndefined()
  })
})
