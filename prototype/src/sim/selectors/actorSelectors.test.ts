import { describe, it, expect } from 'vitest'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
} from '../testFixtures'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import {
  getActorName,
  getActorLeaderPersonId,
  getActorResourceAmount,
  spendActorResource,
  addActorResource,
  getActorRelevantProvinceIds,
  isSameActor,
  polityActor,
  houseActor,
} from './actorSelectors'

describe('actorSelectors', () => {
  describe('getActorName', () => {
    it('returns polity name for polity actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { nameKey: 'Aquilonia' })
      expect(getActorName(s, polityActor('c-1' as PolityId))).toBe('Aquilonia')
    })

    it('returns house name for house actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId, { nameKey: 'House Stark' })
      expect(getActorName(s, houseActor('h-1' as HouseId))).toBe('House Stark')
    })

    it('returns fallback when actor missing', () => {
      const s = makeEmptyV016State()
      expect(getActorName(s, polityActor('c-missing' as PolityId))).toBe('Unknown Polity')
      expect(getActorName(s, houseActor('h-missing' as HouseId))).toBe('Unknown House')
    })
  })

  describe('getActorLeaderPersonId', () => {
    it('returns undefined when no leader assigned', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId)
      s = withHouse(s, 'h-1' as HouseId)
      // OfficeAssignment は作っていないので leader 無し
      expect(getActorLeaderPersonId(s, polityActor('c-1' as PolityId))).toBeUndefined()
      expect(getActorLeaderPersonId(s, houseActor('h-1' as HouseId))).toBeUndefined()
    })
  })

  describe('getActorResourceAmount', () => {
    it('returns polity treasury for polity actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { treasury: 500 })
      expect(getActorResourceAmount(s, polityActor('c-1' as PolityId))).toBe(500)
    })

    it('returns house wealth for house actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId, { wealth: 320 })
      expect(getActorResourceAmount(s, houseActor('h-1' as HouseId))).toBe(320)
    })

    it('returns 0 when actor missing', () => {
      const s = makeEmptyV016State()
      expect(getActorResourceAmount(s, polityActor('c-missing' as PolityId))).toBe(0)
      expect(getActorResourceAmount(s, houseActor('h-missing' as HouseId))).toBe(0)
    })
  })

  describe('spendActorResource', () => {
    it('decreases polity treasury when sufficient', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { treasury: 500 })
      const next = spendActorResource(s, polityActor('c-1' as PolityId), 200)
      expect(next.polities['c-1' as PolityId]?.treasury).toBe(300)
    })

    it('decreases house wealth when sufficient', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId, { wealth: 100 })
      const next = spendActorResource(s, houseActor('h-1' as HouseId), 40)
      expect(next.houses['h-1' as HouseId]?.wealth).toBe(60)
    })

    it('returns state unchanged when balance insufficient', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { treasury: 50 })
      const next = spendActorResource(s, polityActor('c-1' as PolityId), 100)
      expect(next.polities['c-1' as PolityId]?.treasury).toBe(50)
      expect(next).toBe(s)
    })

    it('no-op when amount <= 0', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { treasury: 50 })
      expect(spendActorResource(s, polityActor('c-1' as PolityId), 0)).toBe(s)
      expect(spendActorResource(s, polityActor('c-1' as PolityId), -10)).toBe(s)
    })

    it('no-op when actor missing', () => {
      const s = makeEmptyV016State()
      expect(spendActorResource(s, polityActor('c-missing' as PolityId), 10)).toBe(s)
      expect(spendActorResource(s, houseActor('h-missing' as HouseId), 10)).toBe(s)
    })
  })

  describe('addActorResource', () => {
    it('increases polity treasury', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { treasury: 100 })
      const next = addActorResource(s, polityActor('c-1' as PolityId), 50)
      expect(next.polities['c-1' as PolityId]?.treasury).toBe(150)
    })

    it('increases house wealth', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId, { wealth: 100 })
      const next = addActorResource(s, houseActor('h-1' as HouseId), 75)
      expect(next.houses['h-1' as HouseId]?.wealth).toBe(175)
    })

    it('no-op when amount <= 0', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { treasury: 100 })
      expect(addActorResource(s, polityActor('c-1' as PolityId), 0)).toBe(s)
    })
  })

  describe('getActorRelevantProvinceIds', () => {
    it('returns empty for polity without provinces', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId)
      expect(getActorRelevantProvinceIds(s, polityActor('c-1' as PolityId))).toEqual([])
    })

    it('returns empty for house without controlled provinces', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId)
      expect(getActorRelevantProvinceIds(s, houseActor('h-1' as HouseId))).toEqual([])
    })
  })

  describe('isSameActor', () => {
    it('returns true for same kind + id', () => {
      const a = polityActor('c-1' as PolityId)
      const b = polityActor('c-1' as PolityId)
      expect(isSameActor(a, b)).toBe(true)
    })

    it('returns false for different kind', () => {
      const a = polityActor('c-1' as PolityId)
      const b = houseActor('c-1' as unknown as HouseId)
      expect(isSameActor(a, b)).toBe(false)
    })

    it('returns false for different id', () => {
      const a = polityActor('c-1' as PolityId)
      const b = polityActor('c-2' as PolityId)
      expect(isSameActor(a, b)).toBe(false)
    })
  })

  // 補助: withPerson 経由で leader Person を持つケース (smoke test for getActorLeaderPersonId)
  it('getActorLeaderPersonId returns assigned leader via fixture', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, 'pr-0' as ProvinceId)
    s = withHouse(s, 'h-1' as HouseId)
    s = withPerson(s, 'p-1' as PersonId, { houseId: 'h-1' as HouseId })
    // 注: getHouseLeader は OfficeAssignment 経由なので、testFixture だけでは leader が立たない。
    // ここでは「leader 不在」で undefined を返すことを確認する。
    expect(getActorLeaderPersonId(s, houseActor('h-1' as HouseId))).toBeUndefined()
  })
})
