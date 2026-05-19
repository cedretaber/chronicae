import { describe, it, expect } from 'vitest'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import type { HouseId, PolityId, ProvinceId } from '../types/ids'
import { findLandAcquireIntentCandidates } from './landAcquireCandidates'
import { defaultConfig } from '../config/defaultConfig'

function buildWorld(opts: {
  acquirerTreasury: number
  acquirerLastWarMonth?: number
  targetCommonwealth?: boolean
  acquirerCommonwealth?: boolean
}) {
  let s = makeEmptyV016State()
  const provinceAId = 'pr-a' as ProvinceId
  const provinceBId = 'pr-b' as ProvinceId
  const acquirerPolityId = 'c-acquirer' as PolityId
  const targetPolityId = 'c-target' as PolityId
  const acquirerHouseId = 'h-acquirer' as HouseId
  const targetHouseId = 'h-target' as HouseId

  s = withProvince(s, provinceAId, {
    neighbors: [provinceBId],
    popGroupIds: [],
    development: 10,
  })
  s = withProvince(s, provinceBId, {
    neighbors: [provinceAId],
    popGroupIds: [],
    development: 25,
  })
  s = withHouse(s, acquirerHouseId, { seatProvinceId: provinceAId })
  s = withHouse(s, targetHouseId, { seatProvinceId: provinceBId })
  s = withPolity(s, acquirerPolityId, {
    rank: 2,
    treasury: opts.acquirerTreasury,
    capitalProvinceId: provinceAId,
  })
  s = withPolity(s, targetPolityId, {
    rank: 2,
    treasury: 50, // acquireLandMinTreasury (200) 未満 → target は逆方向の acquirer にならない
    capitalProvinceId: provinceBId,
  })
  if (!opts.acquirerCommonwealth) {
    s = bindProvinceToHouseViaPolity(s, provinceAId, acquirerPolityId, acquirerHouseId)
  }
  if (!opts.targetCommonwealth) {
    s = bindProvinceToHouseViaPolity(s, provinceBId, targetPolityId, targetHouseId)
  }
  if (opts.acquirerCommonwealth) {
    s = {
      ...s,
      polities: {
        ...s.polities,
        [acquirerPolityId]: {
          ...s.polities[acquirerPolityId]!,
          ownerHouseId: undefined,
          kind: 'commonwealth',
        },
      },
    }
  }
  if (opts.targetCommonwealth) {
    s = {
      ...s,
      polities: {
        ...s.polities,
        [targetPolityId]: {
          ...s.polities[targetPolityId]!,
          ownerHouseId: undefined,
          kind: 'commonwealth',
        },
      },
    }
  }
  if (opts.acquirerLastWarMonth !== undefined) {
    s = {
      ...s,
      polities: {
        ...s.polities,
        [acquirerPolityId]: {
          ...s.polities[acquirerPolityId]!,
          lastWarMonth: opts.acquirerLastWarMonth,
        },
      },
    }
  }

  return { state: s, acquirerPolityId, targetPolityId, provinceBId }
}

describe('findLandAcquireIntentCandidates', () => {
  it('returns candidate when conditions are met (acquirer rich + adjacent + non-commonwealth target)', () => {
    const { state, acquirerPolityId, targetPolityId, provinceBId } = buildWorld({
      acquirerTreasury: defaultConfig.acquireLandMinTreasury + 500,
    })
    const candidates = findLandAcquireIntentCandidates(state, defaultConfig)
    expect(candidates.length).toBe(1)
    expect(candidates[0]?.acquirerPolityId).toBe(acquirerPolityId)
    expect(candidates[0]?.targetPolityId).toBe(targetPolityId)
    expect(candidates[0]?.provinceId).toBe(provinceBId)
    expect(candidates[0]?.intentPriority).toBeGreaterThan(0)
  })

  it('returns empty when acquirer treasury below threshold', () => {
    const { state } = buildWorld({
      acquirerTreasury: defaultConfig.acquireLandMinTreasury - 10,
    })
    expect(findLandAcquireIntentCandidates(state, defaultConfig)).toEqual([])
  })

  it('returns empty when acquirer is commonwealth', () => {
    const { state } = buildWorld({
      acquirerTreasury: defaultConfig.acquireLandMinTreasury + 500,
      acquirerCommonwealth: true,
    })
    expect(findLandAcquireIntentCandidates(state, defaultConfig)).toEqual([])
  })

  it('returns empty when target is commonwealth (受動防衛)', () => {
    const { state } = buildWorld({
      acquirerTreasury: defaultConfig.acquireLandMinTreasury + 500,
      targetCommonwealth: true,
    })
    expect(findLandAcquireIntentCandidates(state, defaultConfig)).toEqual([])
  })

  it('respects lastWarMonth cooldown', () => {
    let s = makeEmptyV016State()
    const provinceAId = 'pr-a' as ProvinceId
    const provinceBId = 'pr-b' as ProvinceId
    const acquirerPolityId = 'c-acquirer' as PolityId
    const targetPolityId = 'c-target' as PolityId
    const acquirerHouseId = 'h-acquirer' as HouseId
    const targetHouseId = 'h-target' as HouseId

    s = withProvince(s, provinceAId, { neighbors: [provinceBId], popGroupIds: [] })
    s = withProvince(s, provinceBId, { neighbors: [provinceAId], popGroupIds: [] })
    s = withHouse(s, acquirerHouseId, { seatProvinceId: provinceAId })
    s = withHouse(s, targetHouseId, { seatProvinceId: provinceBId })
    s = withPolity(s, acquirerPolityId, {
      rank: 2,
      treasury: defaultConfig.acquireLandMinTreasury + 1000,
      capitalProvinceId: provinceAId,
    })
    s = withPolity(s, targetPolityId, { rank: 2, treasury: 50, capitalProvinceId: provinceBId })
    s = bindProvinceToHouseViaPolity(s, provinceAId, acquirerPolityId, acquirerHouseId)
    s = bindProvinceToHouseViaPolity(s, provinceBId, targetPolityId, targetHouseId)

    // currentYear=1000, currentMonth=1 → currentAbsoluteMonth=12001
    s = { ...s, currentYear: 1000, currentMonth: 1 }
    // lastWarMonth=12000 → diff=1 < warCooldownMonths (24) → cooldown 中
    s = {
      ...s,
      polities: {
        ...s.polities,
        [acquirerPolityId]: {
          ...s.polities[acquirerPolityId]!,
          lastWarMonth: 12000,
        },
      },
    }
    expect(findLandAcquireIntentCandidates(s, defaultConfig)).toEqual([])
  })

  it('returns empty when acquireLandIntentEnabled is false', () => {
    const { state } = buildWorld({
      acquirerTreasury: defaultConfig.acquireLandMinTreasury + 500,
    })
    const config = { ...defaultConfig, acquireLandIntentEnabled: false }
    expect(findLandAcquireIntentCandidates(state, config)).toEqual([])
  })
})
