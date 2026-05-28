import { describe, expect, it } from 'vitest'
import { createPolityId, createHouseId, createProvinceId, createPersonId } from '../types/ids'
import type { PolityId, HouseId, ProvinceId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import {
  createHouse,
  deactivateHouse,
  addHouseWealth,
  dispersePersonsToHouseless,
  addHouselessPerson,
} from './houseMutations'
import { makeEmptyV016State, withHouse, withPerson } from '../testFixtures'

function makeFixture(): {
  state: WorldState
  polity1Id: PolityId
  house1Id: HouseId
  provinceId: ProvinceId
} {
  const polity1Id = createPolityId('c', 0)
  const house1Id = createHouseId('h', 0)
  const provinceId = createProvinceId('p', 0)

  const state: WorldState = {
    currentYear: 1444,
    absoluteWeek: 69312,
    currentWeekOfYear: 1,
    provinces: {
      [provinceId]: {
        id: provinceId,
        stateId: 'sr-0' as import('../types/ids').StateRegionId,
        nameKey: 'Test Province',
        x: 0,
        y: 0,
        neighbors: [],
        holdingIds: [],
        habitability: 50,
      },
    },
    holdings: {},
    states: {},
    polities: {
      [polity1Id]: {
        id: polity1Id,
        nameKey: 'Polity 1',
        rank: 2,
        ownerHouseId: house1Id,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: provinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        nameKey: 'House 1',
        active: true,
        memberIds: [],
        deceasedMemberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: provinceId,
      },
    },
    persons: {},
    livingPersonIds: [],
    activePlots: {},
    popGroups: {},
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    diplomaticPlays: {},
    diplomaticOffers: {},
    projects: {},
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
    nextProjectId: 0,
    nextDiplomaticPlayId: 0,
    nextDiplomaticOfferId: 0,
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    nextPressureId: 1,
    // v0.22 Goal/Aim system
    goals: {},
    aims: {},
    decisionReasons: {},
    goalIndex: { byOwner: {} },
    aimIndex: { byOwner: {}, byGoal: {} },
    nextGoalId: 0,
    nextAimId: 0,
    nextDecisionReasonId: 0,
    tasks: {},
    taskIndex: { byAssignee: {}, byOwner: {}, byTarget: {} },
    personActivityLogs: {},
    personActivityLogIndex: { byPerson: {} },
    personTrainingExperience: {},
    waitingAimIds: [],
    nextTaskId: 0,
    nextPersonActivityLogId: 0,
  }
  return { state, polity1Id, house1Id, provinceId }
}

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

describe('createHouse', () => {
  it('creates a house with correct initial values', () => {
    const { state, polity1Id, provinceId } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, {
      nameKey: 'New House',
      polityId: polity1Id,
      seatProvinceId: provinceId,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newHouse = result.value.ctx.state.houses[houseId]
    expect(newHouse).toBeDefined()
    expect(newHouse!.nameKey).toBe('New House')
    expect(newHouse!.active).toBe(true)
    expect(newHouse!.memberIds).toEqual([])
  })

  it('updates parent house cadetHouseIds when parentHouseId is given', () => {
    const { state, polity1Id, house1Id, provinceId } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, {
      nameKey: 'Cadet House',
      polityId: polity1Id,
      seatProvinceId: provinceId,
      parentHouseId: house1Id,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newState = result.value.ctx.state
    expect(newState.houses[house1Id]!.cadetHouseIds).toContain(houseId)
  })

  it('returns err when polity not found', () => {
    const { state, provinceId } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, {
      nameKey: 'X',
      polityId: createPolityId('c', 99),
      seatProvinceId: provinceId,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('POLITY_NOT_FOUND')
  })

  it('creates house without polityId (houseless founding)', () => {
    const { state, provinceId } = makeFixture()
    const ctx = makeCtx(state)
    const result = createHouse(ctx, {
      nameKey: 'Self-Made House',
      seatProvinceId: provinceId,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { houseId } = result.value.value
    const newHouse = result.value.ctx.state.houses[houseId]
    expect(newHouse).toBeDefined()
    expect(newHouse!.nameKey).toBe('Self-Made House')
    expect(newHouse!.seatProvinceId).toBe(provinceId)
    expect(newHouse!.active).toBe(true)
  })
})

describe('deactivateHouse', () => {
  it('marks house as inactive', () => {
    const { state, house1Id } = makeFixture()
    const result = deactivateHouse(state, house1Id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.houses[house1Id]!.active).toBe(false)
  })

  it('is a no-op when already inactive', () => {
    const { state, house1Id } = makeFixture()
    const first = deactivateHouse(state, house1Id)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const result = deactivateHouse(first.value, house1Id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(first.value)
  })

  it('returns err when house not found', () => {
    const { state } = makeFixture()
    const result = deactivateHouse(state, createHouseId('h', 99))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

describe('addHouseWealth', () => {
  it('adds delta to house wealth', () => {
    const { state, house1Id } = makeFixture()
    const result = addHouseWealth(state, house1Id, 75)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.houses[house1Id]!.wealth).toBe(75)
  })

  it('floors at 0 for negative delta larger than wealth', () => {
    const { state, house1Id } = makeFixture()
    const result = addHouseWealth(state, house1Id, -200)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.houses[house1Id]!.wealth).toBe(0)
  })

  it('returns err when house not found', () => {
    const { state } = makeFixture()
    const result = addHouseWealth(state, createHouseId('h', 99), 10)
    expect(result.ok).toBe(false)
  })
})

describe('dispersePersonsToHouseless', () => {
  function makeDisperseFixture(): {
    state: WorldState
    sourceHouseId: HouseId
    livingPersonId: PersonId
    deadPersonId: PersonId
    placeholderPersonId: PersonId
  } {
    const sourceHouseId = createHouseId('h', 10)
    const livingPersonId = createPersonId('pe', 10)
    const deadPersonId = createPersonId('pe', 11)
    const placeholderPersonId = createPersonId('pe', 12)

    let state = makeEmptyV016State()
    state = withHouse(state, sourceHouseId, {
      nameKey: 'Source House',
      active: true,
      memberIds: [livingPersonId, deadPersonId, placeholderPersonId],
    })
    state = withPerson(state, livingPersonId, {
      nameKey: 'Living',
      houseId: sourceHouseId,
      alive: true,
    })
    state = withPerson(state, deadPersonId, {
      nameKey: 'Dead',
      houseId: sourceHouseId,
      alive: false,
    })
    state = withPerson(state, placeholderPersonId, {
      nameKey: 'Placeholder',
      houseId: sourceHouseId,
      alive: true,
      kind: 'placeholder',
    })
    return { state, sourceHouseId, livingPersonId, deadPersonId, placeholderPersonId }
  }

  it('moves living non-placeholder members to houseless state', () => {
    const { state, sourceHouseId, livingPersonId } = makeDisperseFixture()
    const result = dispersePersonsToHouseless(state, { houseId: sourceHouseId, year: 1450 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.persons[livingPersonId]!.houseId).toBeUndefined()
    expect(result.value.persons[livingPersonId]!.lastHouseTransferYear).toBe(1450)
  })

  it('keeps dead and placeholder members in source house', () => {
    const { state, sourceHouseId, deadPersonId, placeholderPersonId } = makeDisperseFixture()
    const result = dispersePersonsToHouseless(state, { houseId: sourceHouseId, year: 1450 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const source = result.value.houses[sourceHouseId]!
    expect(source.memberIds).toContain(deadPersonId)
    expect(source.memberIds).toContain(placeholderPersonId)
  })

  it('sets lastHouseTransferYear on transferred persons', () => {
    const { state, sourceHouseId, livingPersonId } = makeDisperseFixture()
    const result = dispersePersonsToHouseless(state, { houseId: sourceHouseId, year: 1450 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[livingPersonId]!.lastHouseTransferYear).toBe(1450)
  })

  it('filters source house.memberIds to remove transferred persons', () => {
    const { state, sourceHouseId, livingPersonId, deadPersonId, placeholderPersonId } =
      makeDisperseFixture()
    const result = dispersePersonsToHouseless(state, { houseId: sourceHouseId, year: 1450 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const source = result.value.houses[sourceHouseId]!
    expect(source.memberIds).not.toContain(livingPersonId)
    expect(source.memberIds).toContain(deadPersonId)
    expect(source.memberIds).toContain(placeholderPersonId)
  })

  it('is a no-op when source has no living member', () => {
    const { state, sourceHouseId } = makeDisperseFixture()
    // Remove all living members by dispersing them first
    const result = dispersePersonsToHouseless(state, { houseId: sourceHouseId, year: 1450 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Now source has only dead/placeholder members
    const source = result.value.houses[sourceHouseId]!
    expect(source.memberIds.length).toBe(2) // dead + placeholder
  })

  it('returns err when source house not found', () => {
    const { state } = makeFixture()
    const result = dispersePersonsToHouseless(state, {
      houseId: createHouseId('h', 99),
      year: 1450,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_NOT_FOUND')
  })
})

describe('addHouselessPerson', () => {
  function makeAddPersonFixture(): {
    state: WorldState
    personId: PersonId
  } {
    const personId = createPersonId('pe', 20)
    const state = makeEmptyV016State()
    return { state, personId }
  }

  it('valid input → person added without houseId', () => {
    const { state, personId } = makeAddPersonFixture()
    const person = {
      id: personId,
      nameKey: 'New Person',
      sex: 'male' as const,
      age: 25,
      alive: true,
      childIds: [],
      birthStatus: 'unknown' as const,
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      aptitudes: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 0,
      wealth: 0,
      attitudes: {},
      lastHouseTransferYear: 1450,
    }
    const result = addHouselessPerson(state, person)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.persons[personId]).toBeDefined()
    expect(result.value.persons[personId]!.houseId).toBeUndefined()
  })

  it('person.houseId defined → err', () => {
    const { state, personId } = makeAddPersonFixture()
    const person = {
      id: personId,
      nameKey: 'Wrong House',
      sex: 'male' as const,
      age: 25,
      alive: true,
      houseId: createHouseId('h', 99),
      childIds: [],
      birthStatus: 'unknown' as const,
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      aptitudes: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 0,
      wealth: 0,
      attitudes: {},
    }
    const result = addHouselessPerson(state, person)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HOUSE_MISMATCH')
  })

  it('Person.id already exists → err', () => {
    const { state, personId } = makeAddPersonFixture()
    const existingPerson = {
      id: personId,
      nameKey: 'Existing',
      sex: 'male' as const,
      age: 30,
      alive: true,
      childIds: [],
      birthStatus: 'unknown' as const,
      abilities: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      aptitudes: { valor: 50, command: 50, numeracy: 50, learning: 50, charisma: 50, insight: 50 },
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 0,
      wealth: 0,
      attitudes: {},
    }
    const updatedState = { ...state, persons: { [personId]: existingPerson } }
    const newPerson = {
      ...existingPerson,
      id: personId,
      nameKey: 'Duplicate',
    }
    const result = addHouselessPerson(updatedState, newPerson)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PERSON_ALREADY_EXISTS')
  })
})
