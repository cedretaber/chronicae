import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { moveHouseToPolity, createPolity, deactivatePolity } from './polityMutations'

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
  house1Id: HouseId
  house2Id: HouseId
  polity1Id: PolityId
  polity2Id: PolityId
  provinceId: ProvinceId
  person1Id: PersonId
} {
  const house1Id = createHouseId('h', 0)
  const house2Id = createHouseId('h', 1)
  const polity1Id = createPolityId('c', 0)
  const polity2Id = createPolityId('c', 1)
  const provinceId = createProvinceId('p', 0)
  const province2Id = createProvinceId('p', 1)
  const person1Id = createPersonId('pe', 0)

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
        development: 0,
        polityControl: 100,
      },
      [province2Id]: {
        id: province2Id,
        name: 'Test Province 2',
        x: 1,
        y: 1,
        neighbors: [],
        habitability: 50,
        popGroupIds: [],
        development: 0,
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
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
      [polity2Id]: {
        id: polity2Id,
        name: 'Polity 2',
        rank: 2,
        ownerHouseId: house2Id,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: province2Id,
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
        wealth: 0,
        seatProvinceId: provinceId,
      },
      [house2Id]: {
        id: house2Id,
        name: 'House 2',
        active: true,
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: province2Id,
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
  return { state, house1Id, house2Id, polity1Id, polity2Id, provinceId, person1Id }
}

describe('moveHouseToPolity', () => {
  it('returns state unchanged (no-op)', () => {
    const { state, house1Id, polity2Id } = makeFixture()
    const result = moveHouseToPolity(state, house1Id, polity2Id)

    expect(result.ok).toBe(true)
  })

  it('returns err when houseId does not exist', () => {
    const { state } = makeFixture()
    const result = moveHouseToPolity(state, createHouseId('h', 99), createPolityId('c', 2))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

describe('createPolity', () => {
  it('creates a polity with correct initial values', () => {
    const { state, house1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = createPolity(ctx, {
      name: 'New Polity',
      treasury: 200,
      legacyPrestige: 30,
      ownerHouseId: house1Id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { polityId } = result.value.value
    const newPolity = result.value.ctx.state.polities[polityId]
    expect(newPolity).toBeDefined()
    expect(newPolity!.name).toBe('New Polity')
    expect(newPolity!.treasury).toBe(200)
    expect(newPolity!.legacyPrestige).toBe(30)
    expect(newPolity!.active).toBe(true)
  })

  it('allocates a unique dp- prefixed polityId', () => {
    const { state, house1Id } = makeFixture()
    const ctx = makeCtx(state)
    const result = createPolity(ctx, { name: 'Polity X', ownerHouseId: house1Id })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { polityId } = result.value.value
    expect((polityId as string).startsWith('dp-')).toBe(true)
  })
})

describe('deactivatePolity', () => {
  it('marks polity as inactive', () => {
    const { state, polity1Id } = makeFixture()
    const result = deactivatePolity(state, polity1Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.polities[polity1Id]!.active).toBe(false)
  })

  it('is a no-op when already inactive', () => {
    const { state, polity1Id } = makeFixture()
    const first = deactivatePolity(state, polity1Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const result = deactivatePolity(first.value, polity1Id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(first.value)
  })

  it('returns err when polity not found', () => {
    const { state } = makeFixture()
    const result = deactivatePolity(state, createPolityId('c', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('POLITY_NOT_FOUND')
  })
})
