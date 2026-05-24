import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { HouseId, PolityId, ProvinceId } from '../types/ids'
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
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'

function setup(build: (s: WorldState) => WorldState): {
  state: WorldState
  pid: (n: number) => ProvinceId
  cid: (n: number) => PolityId
  hid: (n: number) => HouseId
} {
  const state = build(makeEmptyV016State())
  return {
    state,
    pid: (n) => createProvinceId('pr', n),
    cid: (n) => createPolityId('c', n),
    hid: (n) => createHouseId('h', n),
  }
}

describe('polityRelations - basic Province/Polity', () => {
  it('getProvincePolity returns the polity for the province', () => {
    const cid = createPolityId('c', 1)
    const pid = createProvinceId('pr', 1)
    const hid = createHouseId('h', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, hid)
    state = withProvince(state, pid)
    state = withPolity(state, cid, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, pid, cid, hid)

    expect(getProvincePolity(state, pid)?.id).toBe(cid)
  })

  it('getProvincePolity returns undefined for non-existent province', () => {
    const state = makeEmptyV016State()
    const missing = createProvinceId('pr', 99)
    expect(getProvincePolity(state, missing)).toBeUndefined()
  })

  it('getProvinceOwnerHouse returns the owner house', () => {
    const hid = createHouseId('h', 1)
    const pid = createProvinceId('pr', 1)
    const cid = createPolityId('c', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, hid)
    state = withProvince(state, pid)
    state = withPolity(state, cid, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, pid, cid, hid)

    expect(getProvinceOwnerHouse(state, pid)?.id).toBe(hid)
  })
})

describe('polityRelations - getPolityProvinceIds', () => {
  it('returns provinces in the polity sorted ascending', () => {
    const cid = createPolityId('c', 1)
    const otherCid = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    let state = makeEmptyV016State()
    state = withHouse(state, hid)
    state = withProvince(state, p1)
    state = withProvince(state, p2)
    state = withProvince(state, p3)
    state = withPolity(state, cid, { ownerHouseId: hid })
    state = withPolity(state, otherCid, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, p1, cid, hid)
    state = bindProvinceToHouseViaPolity(state, p3, cid, hid)
    state = bindProvinceToHouseViaPolity(state, p2, otherCid, hid)

    const result = getPolityProvinceIds(state, cid)
    expect(result.map((id) => id as string)).toEqual(['pr-1', 'pr-3'])
  })

  it('returns empty list for polity with no provinces', () => {
    const { state, cid } = setup((s) => withPolity(s, createPolityId('c', 1)))
    expect(getPolityProvinceIds(state, cid(1))).toEqual([])
  })
})

describe('polityRelations - getPolityHouseIds', () => {
  it('returns active houses with provinces in the polity, sorted', () => {
    // v0.16: chain depth 1 means each Province has exactly one terminal Polity.
    // getPolityHouseIds returns Polity.ownerHouse plus any house owning a
    // Province within the polity (via that province's effective owner).
    // Here we model it as the owner-house of the polity plus one Polity that
    // delegates ownership to a different house through a second LandContract.
    const cid = createPolityId('c', 1)
    const h1 = createHouseId('h', 1)
    const h2 = createHouseId('h', 2)
    const inactive = createHouseId('h', 3)
    const p1 = createProvinceId('pr', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, h1)
    state = withHouse(state, h2)
    state = withHouse(state, inactive, { active: false })
    state = withProvince(state, p1)
    state = withPolity(state, cid, { ownerHouseId: h1 })
    state = bindProvinceToHouseViaPolity(state, p1, cid, h1)

    const result = getPolityHouseIds(state, cid)
    expect(result.map((id) => id as string)).toEqual(['h-1'])
  })

  it('deduplicates houses that own multiple provinces in the polity', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    let state = makeEmptyV016State()
    state = withHouse(state, hid)
    state = withProvince(state, p1)
    state = withProvince(state, p2)
    state = withPolity(state, cid, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, p1, cid, hid)
    state = bindProvinceToHouseViaPolity(state, p2, cid, hid)

    expect(getPolityHouseIds(state, cid)).toEqual([hid])
  })
})

describe('polityRelations - getPolityPersonIds', () => {
  it('returns alive members of polity houses, including duplicates across polities', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const alive = createPersonId('pe', 1)
    const dead = createPersonId('pe', 2)
    const p1 = createProvinceId('pr', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, hid)
    state = withProvince(state, p1)
    state = withPolity(state, cid, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, p1, cid, hid)
    state = withPerson(state, alive, { houseId: hid, alive: true })
    state = withPerson(state, dead, { houseId: hid, alive: false })

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
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: p1 })
    state = withProvince(state, p1)
    state = withProvince(state, p2)
    state = withProvince(state, p3)
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = withPolity(state, c2, { ownerHouseId: hid })
    state = withPolity(state, inactiveC, { ownerHouseId: hid, active: false })
    state = bindProvinceToHouseViaPolity(state, p1, c1, hid)
    state = bindProvinceToHouseViaPolity(state, p2, c1, hid)
    state = bindProvinceToHouseViaPolity(state, p3, c2, hid)

    const result = getHousePolityIds(state, hid)
    expect(result.map((id) => id as string)).toEqual(['c-1', 'c-2'])
  })

  it('getHousePolityIds returns empty for inactive house', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    let state = makeEmptyV016State()
    state = withProvince(state, p1)
    state = withHouse(state, hid, { active: false })
    state = withPolity(state, cid)

    expect(getHousePolityIds(state, hid)).toEqual([])
  })

  it('getHouseProvinceIdsByPolity filters house provinces by polity', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: p1 })
    state = withProvince(state, p1)
    state = withProvince(state, p2)
    state = withProvince(state, p3)
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = withPolity(state, c2, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, p1, c1, hid)
    state = bindProvinceToHouseViaPolity(state, p2, c1, hid)
    state = bindProvinceToHouseViaPolity(state, p3, c2, hid)

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
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: seat })
    state = withProvince(state, seat)
    state = withProvince(state, other)
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = withPolity(state, c2, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, seat, c1, hid)
    state = bindProvinceToHouseViaPolity(state, other, c2, hid)

    expect(getHousePrimaryPolityId(state, hid)).toBe(c1)
  })

  it('falls back to polity with most provinces when seat is in a polity house no longer owns', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const seat = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: seat })
    state = withProvince(state, seat)
    state = withProvince(state, p2)
    state = withProvince(state, p3)
    // Seat is owned by some unrelated house's polity, not hid's.
    const otherOwner = createHouseId('h', 99)
    state = withHouse(state, otherOwner)
    const c0 = createPolityId('c', 0)
    state = withPolity(state, c0, { ownerHouseId: otherOwner })
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = withPolity(state, c2, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, seat, c0, otherOwner)
    state = bindProvinceToHouseViaPolity(state, p2, c2, hid)
    state = bindProvinceToHouseViaPolity(state, p3, c2, hid)

    expect(getHousePrimaryPolityId(state, hid)).toBe(c2)
  })

  it('returns undefined for inactive house or empty provinceIds', () => {
    const cid = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { active: false })
    state = withPolity(state, cid)
    expect(getHousePrimaryPolityId(state, hid)).toBeUndefined()
  })

  it('breaks ties by development sum, then by polity id ascending', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: p1 })
    state = withProvince(state, p1)
    state = withProvince(state, p2)
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = withPolity(state, c2, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, p1, c1, hid)
    state = bindProvinceToHouseViaPolity(state, p2, c2, hid)
    // seat (p1) belongs to c1 — rule 1 takes precedence over development sum.
    expect(getHousePrimaryPolityId(state, hid)).toBe(c1)
  })
})

describe('polityRelations - Person -> Polity', () => {
  it('getPersonRelevantPolityIds delegates to the person house', () => {
    const c1 = createPolityId('c', 1)
    const hid = createHouseId('h', 1)
    const personId = createPersonId('pe', 1)
    const p1 = createProvinceId('pr', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: p1 })
    state = withProvince(state, p1)
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, p1, c1, hid)
    state = withPerson(state, personId, { houseId: hid })

    expect(getPersonRelevantPolityIds(state, personId)).toEqual([c1])
    expect(getPersonPrimaryPolityId(state, personId)).toBe(c1)
  })

  it('returns empty / undefined for missing person', () => {
    const state = makeEmptyV016State()
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
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: seat })
    state = withProvince(state, seat)
    state = withPolity(state, cid, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, seat, cid, hid)

    expect(getHouseSeatProvinceInPolity(state, hid, cid)).toBe(seat)
  })

  it('picks the province with highest development when seat is not in the target polity', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const seat = createProvinceId('pr', 1)
    const p2 = createProvinceId('pr', 2)
    const p3 = createProvinceId('pr', 3)
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: seat })
    state = withProvince(state, seat)
    state = withProvince(state, p2)
    state = withProvince(state, p3)
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = withPolity(state, c2, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, seat, c1, hid)
    state = bindProvinceToHouseViaPolity(state, p2, c2, hid)
    state = bindProvinceToHouseViaPolity(state, p3, c2, hid)
    // v0.27: development is now derived from HoldingImprovement (all 0 in tests).
    // With equal development, tiebreaker falls to population then ProvinceId alphabetical.
    expect(getHouseSeatProvinceInPolity(state, hid, c2)).toBe(p2)
  })

  it('returns undefined when the house has no provinces in the polity', () => {
    const c1 = createPolityId('c', 1)
    const c2 = createPolityId('c', 2)
    const hid = createHouseId('h', 1)
    const p1 = createProvinceId('pr', 1)
    let state = makeEmptyV016State()
    state = withHouse(state, hid, { seatProvinceId: p1 })
    state = withProvince(state, p1)
    state = withPolity(state, c1, { ownerHouseId: hid })
    state = withPolity(state, c2, { ownerHouseId: hid })
    state = bindProvinceToHouseViaPolity(state, p1, c1, hid)

    expect(getHouseSeatProvinceInPolity(state, hid, c2)).toBeUndefined()
  })
})
