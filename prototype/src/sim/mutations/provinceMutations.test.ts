import {
  getHouseControlledProvinceIds,
  getProvinceEffectiveOwnerHouseId,
  getProvinceTerminalPolityId,
} from '../selectors/landContractSelectors'
import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { collectIntegrityErrors } from '../tick/integritySystem'
import {
  transferProvinceToHouse,
  transferProvinceToPolity,
  adjustProvinceDevelopment,
} from './provinceMutations'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

function makeFixture(): {
  state: WorldState
  provinceId: ProvinceId
  house1Id: HouseId
  house2Id: HouseId
  polity1Id: PolityId
  polity2Id: PolityId
} {
  const provinceId = createProvinceId('p', 0)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const polity1Id = createPolityId('c', 0)
  const polity2Id = createPolityId('c', 1)

  // Second province satisfies §25 #17 (polity2 must have ≥1 LandContract grantee).
  const auxProvinceId = createProvinceId('p', 1)
  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312 }
  state = withProvince(state, provinceId, { nameKey: 'Test Province' })
  // Set Holding development to 0 for adjustProvinceDevelopment tests
  const p0HoldingId = state.provinces[provinceId]!.holdingIds[0]!
  state = {
    ...state,
    holdings: {
      ...state.holdings,
      [p0HoldingId]: { ...state.holdings[p0HoldingId]!, development: 0 },
    },
  }
  state = withProvince(state, auxProvinceId, { nameKey: 'Aux Province' })
  state = withHouse(state, house1Id, { nameKey: 'House 1', seatProvinceId: provinceId })
  state = withHouse(state, house2Id, { nameKey: 'House 2', seatProvinceId: auxProvinceId })
  state = withPolity(state, polity1Id, {
    nameKey: 'Polity 1',
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
    ownerHouseId: house1Id,
  })
  state = withPolity(state, polity2Id, {
    nameKey: 'Polity 2',
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: auxProvinceId,
    ownerHouseId: house2Id,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polity1Id, house1Id)
  state = bindProvinceToHouseViaPolity(state, auxProvinceId, polity2Id, house2Id)
  return { state, provinceId, house1Id, house2Id, polity1Id, polity2Id }
}

describe('transferProvinceToHouse', () => {
  it('Province ownerHouseId and polityId are updated correctly', () => {
    const { state, provinceId, house2Id, polity2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(getProvinceEffectiveOwnerHouseId(result.value, provinceId)).toBe(house2Id)
      expect(getProvinceTerminalPolityId(result.value, provinceId)).toBe(polity2Id)
    }
  })

  it('old house provinceIds no longer contains the provinceId', () => {
    const { state, provinceId, house1Id, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(getHouseControlledProvinceIds(result.value, house1Id)).not.toContain(provinceId)
  })

  it('new house provinceIds contains the provinceId', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(getHouseControlledProvinceIds(result.value, house2Id)).toContain(provinceId)
  })

  it('original state is not mutated', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).not.toBe(state)
  })

  it('returns err when provinceId does not exist', () => {
    const { state } = makeFixture()
    const result = transferProvinceToHouse(state, createProvinceId('p', 99), createHouseId('h', 2))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PROVINCE_NOT_FOUND')
  })

  it('returns err when newOwnerHouseId does not exist', () => {
    const { state, provinceId } = makeFixture()
    const result = transferProvinceToHouse(state, provinceId, createHouseId('h', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

describe('transferProvinceToPolity', () => {
  it('transfers province to a house within the target polity', () => {
    const { state, provinceId, house2Id, polity2Id } = makeFixture()
    const result = transferProvinceToPolity(state, provinceId, polity2Id, house2Id)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getProvinceEffectiveOwnerHouseId(result.value, provinceId)).toBe(house2Id)
    expect(getProvinceTerminalPolityId(result.value, provinceId)).toBe(polity2Id)
  })

  it('returns err when province not found', () => {
    const { state, house2Id, polity2Id } = makeFixture()
    const result = transferProvinceToPolity(state, createProvinceId('p', 99), polity2Id, house2Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PROVINCE_NOT_FOUND')
  })

  it('returns err when target polity not found', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const result = transferProvinceToPolity(state, provinceId, createPolityId('c', 99), house2Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('POLITY_NOT_FOUND')
  })

  it('returns err when house does not belong to target polity', () => {
    const { state, provinceId, house1Id, polity2Id } = makeFixture()
    const result = transferProvinceToPolity(state, provinceId, polity2Id, house1Id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('OWNER_MISMATCH')
  })
})

// v0.16: transferProvinceToHouse の newHouseControl オプションは廃止 (houseControl 廃止のため)。
// 代替: terminal Polity 経由で polityControl が変動するため、別 system で扱う。
describe('transferProvinceToHouse (v0.16)', () => {
  it('preserves polityControl when transferring', () => {
    const { state, provinceId, house2Id } = makeFixture()
    const holdingId = state.provinces[provinceId]!.holdingIds[0]!
    const original = state.holdings[holdingId]!.polityControl
    const result = transferProvinceToHouse(state, provinceId, house2Id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.holdings[holdingId]!.polityControl).toBe(original)
  })
})

describe('adjustProvinceDevelopment', () => {
  it('adds delta to development', () => {
    const { state, provinceId } = makeFixture()
    const holdingId = state.provinces[provinceId]!.holdingIds[0]!
    const result = adjustProvinceDevelopment(state, provinceId, 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.holdings[holdingId]!.development).toBe(10)
  })

  it('clamps to -100..100 by default', () => {
    const { state, provinceId } = makeFixture()
    const holdingId = state.provinces[provinceId]!.holdingIds[0]!
    const r1 = adjustProvinceDevelopment(state, provinceId, 200)
    const r2 = adjustProvinceDevelopment(state, provinceId, -200)

    expect(r1.ok && r1.value.holdings[holdingId]!.development).toBe(100)
    expect(r2.ok && r2.value.holdings[holdingId]!.development).toBe(-100)
  })

  it('respects custom min/max options', () => {
    const { state, provinceId } = makeFixture()
    const holdingId = state.provinces[provinceId]!.holdingIds[0]!
    const result = adjustProvinceDevelopment(state, provinceId, 50, { min: -50, max: 30 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.holdings[holdingId]!.development).toBe(30)
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })

  it('returns err when province not found', () => {
    const { state } = makeFixture()
    const result = adjustProvinceDevelopment(state, createProvinceId('p', 99), 10)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PROVINCE_NOT_FOUND')
  })
})
