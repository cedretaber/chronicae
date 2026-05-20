import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import { createPolityFromHouse } from './polityMutations'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'

function makeFixture(): {
  state: WorldState
  polity1Id: PolityId
  polity2Id: PolityId
  house1Id: HouseId
  house2Id: HouseId
  person1Id: PersonId
} {
  const polity1Id = createPolityId('c', 0)
  const polity2Id = createPolityId('c', 1)
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const person1Id = createPersonId('pe', 0)
  const provinceId = createProvinceId('p', 0)
  const auxProvinceId = createProvinceId('p', 1)

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 75088 }
  state = withProvince(state, provinceId, { name: 'Test Province', development: 10 })
  state = withProvince(state, auxProvinceId, { name: 'Aux Province' })
  state = withHouse(state, house1Id, {
    name: 'House 1',
    memberIds: [person1Id],
    wealth: 1000,
    seatProvinceId: provinceId,
  })
  state = withHouse(state, house2Id, {
    name: 'House 2',
    legacyPrestige: 30,
    wealth: 200,
    seatProvinceId: auxProvinceId,
  })
  state = withPolity(state, polity1Id, {
    name: 'Polity 1',
    ownerHouseId: house1Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    capitalProvinceId: provinceId,
  })
  state = withPolity(state, polity2Id, {
    name: 'Polity 2',
    ownerHouseId: house2Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    capitalProvinceId: auxProvinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polity1Id, house1Id)
  state = bindProvinceToHouseViaPolity(state, auxProvinceId, polity2Id, house2Id)
  state = withPerson(state, person1Id, {
    name: 'Test Person',
    houseId: house1Id,
    birthStatus: 'unknown',
    legacyPrestige: 50,
  })

  return {
    state,
    polity1Id,
    polity2Id,
    house1Id,
    house2Id,
    person1Id,
  }
}

describe('createPolityFromHouse', () => {
  it('creates new polity with correct initial values', () => {
    const { state, house1Id } = makeFixture()
    const newPolityId = createPolityId('c', 10)

    const result = createPolityFromHouse(state, house1Id, newPolityId)

    const newPolity = result.polities[newPolityId]
    expect(newPolity).toBeDefined()
    expect(newPolity!.legacyPrestige).toBe(20)
    expect(newPolity!.adminPower).toBe(0)
    expect(newPolity!.name).toBe('House 1領')
    expect(newPolity!.treasury).toBe(Math.floor(1000 * 0.5))
  })

  it('rebel house moves to new polity', () => {
    const { state, house1Id } = makeFixture()
    const newPolityId = createPolityId('c', 10)

    const result = createPolityFromHouse(state, house1Id, newPolityId)

    // v0.15: rebel house becomes owner of new polity; old polity retains ownerHouseId
    // (since it still has provinces from other houses)
    expect(result.polities[newPolityId]!.ownerHouseId).toBe(house1Id)
  })

  it('old polity receives penalties', () => {
    const { state, house1Id, polity1Id } = makeFixture()
    const newPolityId = createPolityId('c', 10)

    const oldPolity = state.polities[polity1Id]!
    const oldLegacyPrestige = oldPolity.legacyPrestige
    const oldAdminPower = oldPolity.adminPower

    const result = createPolityFromHouse(state, house1Id, newPolityId)

    const updatedOldPolity = result.polities[polity1Id]!
    expect(updatedOldPolity.legacyPrestige).toBe(Math.max(0, oldLegacyPrestige - 10))
    expect(updatedOldPolity.adminPower).toBe(Math.max(0, oldAdminPower - 5))
  })

  it('returns state unchanged if rebelHouseId not found', () => {
    const { state } = makeFixture()
    const fakeHouseId = createHouseId('h', 999)

    const result = createPolityFromHouse(state, fakeHouseId, createPolityId('c', 10))

    expect(result).toBe(state)
  })
})
