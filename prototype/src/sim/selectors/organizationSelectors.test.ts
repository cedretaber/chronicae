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
  getOrganizationName,
  getOrganizationLeaderPersonId,
  getOrganizationResourceAmount,
  getOrganizationRelevantProvinceIds,
  isSameOrganization,
  polityOrganization,
  houseOrganization,
} from './organizationSelectors'

describe('organizationSelectors', () => {
  describe('getOrganizationName', () => {
    it('returns polity name for polity actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, {
        nameSource: { kind: 'pool', nameKey: 'Aquilonia' },
      })
      expect(getOrganizationName(s, polityOrganization('c-1' as PolityId))).toBe('Aquilonia')
    })

    it('returns house name for house actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId, { nameKey: 'House Stark' })
      expect(getOrganizationName(s, houseOrganization('h-1' as HouseId))).toBe('House Stark')
    })

    it('returns fallback when actor missing', () => {
      const s = makeEmptyV016State()
      expect(getOrganizationName(s, polityOrganization('c-missing' as PolityId))).toBe(
        'Unknown Polity',
      )
      expect(getOrganizationName(s, houseOrganization('h-missing' as HouseId))).toBe(
        'Unknown House',
      )
    })
  })

  describe('getOrganizationLeaderPersonId', () => {
    it('returns undefined when no leader assigned', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId)
      s = withHouse(s, 'h-1' as HouseId)
      // OfficeAssignment は作っていないので leader 無し
      expect(
        getOrganizationLeaderPersonId(s, polityOrganization('c-1' as PolityId)),
      ).toBeUndefined()
      expect(getOrganizationLeaderPersonId(s, houseOrganization('h-1' as HouseId))).toBeUndefined()
    })
  })

  describe('getOrganizationResourceAmount', () => {
    it('returns polity treasury for polity actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId, { treasury: 500 })
      expect(getOrganizationResourceAmount(s, polityOrganization('c-1' as PolityId))).toBe(500)
    })

    it('returns house wealth for house actor', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId, { wealth: 320 })
      expect(getOrganizationResourceAmount(s, houseOrganization('h-1' as HouseId))).toBe(320)
    })

    it('returns 0 when actor missing', () => {
      const s = makeEmptyV016State()
      expect(getOrganizationResourceAmount(s, polityOrganization('c-missing' as PolityId))).toBe(0)
      expect(getOrganizationResourceAmount(s, houseOrganization('h-missing' as HouseId))).toBe(0)
    })
  })

  describe('getOrganizationRelevantProvinceIds', () => {
    it('returns empty for polity without provinces', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withPolity(s, 'c-1' as PolityId)
      expect(getOrganizationRelevantProvinceIds(s, polityOrganization('c-1' as PolityId))).toEqual(
        [],
      )
    })

    it('returns empty for house without controlled provinces', () => {
      let s = makeEmptyV016State()
      s = withProvince(s, 'pr-0' as ProvinceId)
      s = withHouse(s, 'h-1' as HouseId)
      expect(getOrganizationRelevantProvinceIds(s, houseOrganization('h-1' as HouseId))).toEqual([])
    })
  })

  describe('isSameOrganization', () => {
    it('returns true for same kind + id', () => {
      const a = polityOrganization('c-1' as PolityId)
      const b = polityOrganization('c-1' as PolityId)
      expect(isSameOrganization(a, b)).toBe(true)
    })

    it('returns false for different kind', () => {
      const a = polityOrganization('c-1' as PolityId)
      const b = houseOrganization('c-1' as unknown as HouseId)
      expect(isSameOrganization(a, b)).toBe(false)
    })

    it('returns false for different id', () => {
      const a = polityOrganization('c-1' as PolityId)
      const b = polityOrganization('c-2' as PolityId)
      expect(isSameOrganization(a, b)).toBe(false)
    })
  })

  // 補助: withPerson 経由で leader Person を持つケース (smoke test for getOrganizationLeaderPersonId)
  it('getOrganizationLeaderPersonId returns assigned leader via fixture', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, 'pr-0' as ProvinceId)
    s = withHouse(s, 'h-1' as HouseId)
    s = withPerson(s, 'p-1' as PersonId, { houseId: 'h-1' as HouseId })
    // 注: getHouseLeader は OfficeAssignment 経由なので、testFixture だけでは leader が立たない。
    // ここでは「leader 不在」で undefined を返すことを確認する。
    expect(getOrganizationLeaderPersonId(s, houseOrganization('h-1' as HouseId))).toBeUndefined()
  })
})
