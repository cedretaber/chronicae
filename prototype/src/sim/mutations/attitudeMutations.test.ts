import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { collectIntegrityErrors } from '../tick/integritySystem'
import { adjustHouseMembersAttitude } from './attitudeMutations'
import { houseAttitudeKey } from '../helpers/attitudeHelpers' // used for assertion key lookup only

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
  person1Id: PersonId
  person2Id: PersonId
  houseId: HouseId
  polityId: PolityId
  provinceId: ProvinceId
} {
  const person1Id = createPersonId('pe', 0)
  const person2Id = createPersonId('pe', 1)
  const houseId = createHouseId('h', 0)
  const polityId = createPolityId('c', 0)
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
        ownerHouseId: houseId,
        polityId: polityId,
        habitability: 50,
        popGroupIds: [],
        development: 10,
        polityControl: 100,
        houseControl: 100,
      },
    },
    polities: {
      [polityId]: {
        id: polityId,
        name: 'Polity 1',
        rank: 2,
        ownerHouseId: houseId,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: provinceId,
      },
    },
    houses: {
      [houseId]: {
        id: houseId,
        name: 'House 1',
        active: true,
        provinceIds: [provinceId],
        memberIds: [person1Id, person2Id],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: provinceId,
      },
    },
    persons: {
      [person1Id]: {
        id: person1Id,
        name: 'Person 1',
        sex: 'male' as const,
        age: 30,
        alive: true,
        houseId: houseId,
        childIds: [],
        birthStatus: 'legitimate' as const,
        abilities: DEFAULT_ABILITIES,
        aptitudes: DEFAULT_ABILITIES,
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 10,
        wealth: 0,
        attitudes: {},
      },
      [person2Id]: {
        id: person2Id,
        name: 'Person 2',
        sex: 'female' as const,
        age: 28,
        alive: false,
        houseId: houseId,
        childIds: [],
        birthStatus: 'legitimate' as const,
        abilities: DEFAULT_ABILITIES,
        aptitudes: DEFAULT_ABILITIES,
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 10,
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
  }
  return { state, person1Id, person2Id, houseId, polityId, provinceId }
}

describe('adjustHouseMembersAttitude', () => {
  it('adjusts attitude for alive members only', () => {
    const { state, person1Id, person2Id, houseId } = makeFixture()
    const key = houseAttitudeKey(houseId)
    const result = adjustHouseMembersAttitude(
      state,
      houseId,
      { kind: 'house', id: houseId },
      { respect: 10 },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // person1 is alive → attitude updated
    expect(result.value.persons[person1Id]!.attitudes[key]?.respect).toBe(10)
    // person2 is dead → attitude unchanged
    expect(result.value.persons[person2Id]!.attitudes[key]).toBeUndefined()
  })

  it('accumulates delta on existing attitude', () => {
    const { state, person1Id, houseId } = makeFixture()
    const key = houseAttitudeKey(houseId)
    const withInitial: WorldState = {
      ...state,
      persons: {
        ...state.persons,
        [person1Id]: {
          ...state.persons[person1Id]!,
          attitudes: { [key]: { affection: 20, respect: 30 } },
        },
      },
    }
    const result = adjustHouseMembersAttitude(
      withInitial,
      houseId,
      { kind: 'house', id: houseId },
      {
        affection: -5,
        respect: 10,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[person1Id]!.attitudes[key]?.affection).toBe(15)
    expect(result.value.persons[person1Id]!.attitudes[key]?.respect).toBe(40)
  })

  it('clamps attitudes to -100..100', () => {
    const { state, person1Id, houseId } = makeFixture()
    const key = houseAttitudeKey(houseId)
    const result = adjustHouseMembersAttitude(
      state,
      houseId,
      { kind: 'house', id: houseId },
      {
        affection: 200,
        respect: -200,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[person1Id]!.attitudes[key]?.affection).toBe(100)
    expect(result.value.persons[person1Id]!.attitudes[key]?.respect).toBe(-100)
  })

  it('returns err when house not found', () => {
    const { state } = makeFixture()
    const result = adjustHouseMembersAttitude(
      state,
      createHouseId('h', 99),
      { kind: 'house', id: createHouseId('h', 99) },
      {
        respect: 5,
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })

  it('passes integrity check', () => {
    const { state, houseId } = makeFixture()
    const result = adjustHouseMembersAttitude(
      state,
      houseId,
      { kind: 'house', id: houseId },
      {
        respect: 5,
      },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(collectIntegrityErrors(result.value)).toEqual([])
  })
})
