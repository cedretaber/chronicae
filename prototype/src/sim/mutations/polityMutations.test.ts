import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { moveHouseToPolity, createPolity, deactivatePolity } from './polityMutations'
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

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312 }
  state = withProvince(state, provinceId, { name: 'Test Province' })
  state = withProvince(state, province2Id, { name: 'Test Province 2', x: 1, y: 1 })
  state = withHouse(state, house1Id, {
    name: 'House 1',
    memberIds: [person1Id],
    seatProvinceId: provinceId,
  })
  state = withHouse(state, house2Id, { name: 'House 2', seatProvinceId: province2Id })
  state = withPolity(state, polity1Id, {
    name: 'Polity 1',
    ownerHouseId: house1Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  state = withPolity(state, polity2Id, {
    name: 'Polity 2',
    ownerHouseId: house2Id,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: province2Id,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polity1Id, house1Id)
  state = bindProvinceToHouseViaPolity(state, province2Id, polity2Id, house2Id)
  state = withPerson(state, person1Id, {
    name: 'Test Person',
    houseId: house1Id,
    birthStatus: 'unknown',
    legacyPrestige: 50,
  })
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
