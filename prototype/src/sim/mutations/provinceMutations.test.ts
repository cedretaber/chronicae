import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { adjustProvinceDevelopment } from './provinceMutations'
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
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
    ownerHouseId: house1Id,
  })
  state = withPolity(state, polity2Id, {
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

describe('adjustProvinceDevelopment', () => {
  it('is a no-op (v0.27: development is derived from HoldingImprovement)', () => {
    const { state, provinceId } = makeFixture()
    const result = adjustProvinceDevelopment(state, provinceId, 10)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(state)
  })
})
