import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { createPolityFromHouse } from './polityMutations'

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

  const state: WorldState = {
    currentYear: 1444,
    currentMonth: 1,
    provinces: {
      [provinceId]: {
        id: provinceId,
        name: 'Test Province',
        x: 0,
        y: 0,
        neighbors: [],
        habitability: 50,
        popGroupIds: [],
        development: 10,
        polityControl: 100,
      },
    },
    polities: {
      [polity1Id]: {
        id: polity1Id,
        name: 'Polity 1',
        rank: 2,
        ownerHouseId: house1Id,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 50,
        active: true,
        capitalProvinceId: provinceId,
      },
      [polity2Id]: {
        id: polity2Id,
        name: 'Polity 2',
        rank: 2,
        ownerHouseId: house2Id,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 50,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        name: 'House 1',
        active: true,
        memberIds: [person1Id],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 1000,
        seatProvinceId: provinceId,
      },
      [house2Id]: {
        id: house2Id,
        name: 'House 2',
        active: true,
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 30,
        wealth: 200,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [person1Id]: {
        id: person1Id,
        name: 'Test Person',
        sex: 'male',
        age: 30,
        alive: true,
        houseId: house1Id,
        childIds: [],
        birthStatus: 'unknown',
        abilities: DEFAULT_ABILITIES,
        aptitudes: DEFAULT_ABILITIES,
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 50,
        wealth: 0,
        attitudes: {},
      },
    },
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    landContracts: {},
    provinceOfficeAssignments: {},
    landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
    provinceTerminalPolityCache: {},
    provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
    polityIndex: { byOwnerHouse: {} },
    nextLandContractId: 0,
    nextProvinceOfficeAssignmentId: 0,
  }
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
