import { describe, it, expect } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from '../tick/context'
import type { WorldState } from '../types/world'
import type { HouseId, ProvinceId, PolityId, PersonId } from '../types/ids'
import type { Province } from '../types/province'
import type { House } from '../types/house'
import type { Person } from '../types/person'
import { extinctHouse } from './worldStructureMutations'

const HOUSELESS_HOUSE_ID = 'h-anon' as HouseId

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('world-struct-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

function makeMinimalWorld(): WorldState {
  const provinceId = 'p-0' as ProvinceId
  const polityId = 'dp-0' as PolityId
  const houseId = 'h-0' as HouseId
  const personId = 'pe-0' as PersonId

  const person: Person = {
    id: personId,
    nameKey: 'TestPerson',
    sex: 'male',
    age: 30,
    alive: true,
    houseId,
    childIds: [],
    birthStatus: 'unknown',
    abilities: {
      valor: 50,
      command: 50,
      numeracy: 50,
      learning: 50,
      charisma: 50,
      insight: 50,
    },
    aptitudes: {
      valor: 50,
      command: 50,
      numeracy: 50,
      learning: 50,
      charisma: 50,
      insight: 50,
    },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 30,
    wealth: 0,
    attitudes: {},
  }

  const house: House = {
    id: houseId,
    nameKey: 'H0',
    active: true,
    memberIds: [personId],
    deceasedMemberIds: [],
    founderId: personId,
    cadetHouseIds: [],
    legacyPrestige: 50,
    wealth: 100,
    seatProvinceId: provinceId,
    kind: 'normal',
  }

  const polity = {
    id: polityId,
    nameKey: 'C0',
    rank: 2 as const,
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    active: true,
    capitalProvinceId: provinceId,
  } as const

  const province: Province = {
    id: provinceId,
    stateId: 'sr-0' as import('../types/ids').StateRegionId,
    nameKey: 'Capital',
    x: 0,
    y: 0,
    terrain: 'plains',
    features: [],
    neighbors: [],
    holdingIds: [],
  }

  const anonHouse: House = {
    id: HOUSELESS_HOUSE_ID,
    nameKey: 'Anonymous',
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
    founderId: personId,
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: provinceId,
    kind: 'system',
  }

  return {
    currentYear: 1,
    currentWeekOfYear: 1,
    absoluteWeek: 48,
    provinces: { [provinceId]: province },
    holdings: {},
    states: {},
    polities: { [polityId]: polity },
    houses: { [houseId]: house, [HOUSELESS_HOUSE_ID]: anonHouse },
    persons: { [personId]: person },
    livingPersonIds: [personId],
    activePlots: {},
    popGroups: {},
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
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
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
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
    wars: {},
    warIndex: { byParticipant: {}, byOriginDiplomaticPlay: {} },
    nextWarId: 0,
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
    clans: {},
    nextClanId: 1,
  }
}

describe('handleNormalHouseExtinction — last-normal-house guard', () => {
  it('single normal house + AnonymousHouse → house remains active (guard triggered)', () => {
    const world = makeMinimalWorld()
    const normalHouseId = 'h-0' as HouseId

    expect(world.houses[normalHouseId]?.active).toBe(true)
    expect(world.houses[HOUSELESS_HOUSE_ID]?.kind).toBe('system')

    const ctx = makeCtx(world)
    const result = extinctHouse(ctx, {
      houseId: normalHouseId,
      affectedPolityIds: [],
    })

    if (!result.ok) {
      throw new Error(`extinctHouse failed: ${result.error.message}`)
    }

    // The guard should prevent extinction: house must remain active
    expect(result.value.ctx.state.houses[normalHouseId]?.active).toBe(true)
  })

  it('two+ normal houses → extinction proceeds without guard', () => {
    const world = makeMinimalWorld()
    const targetHouseId = 'h-0' as HouseId

    // Add a second normal house
    const secondHouseId = 'h-1' as HouseId
    const secondPersonId = 'pe-1' as PersonId
    const secondPerson: Person = {
      id: secondPersonId,
      nameKey: 'SecondPerson',
      sex: 'female',
      age: 25,
      alive: true,
      houseId: secondHouseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: {
        valor: 50,
        command: 50,
        numeracy: 50,
        learning: 50,
        charisma: 50,
        insight: 50,
      },
      aptitudes: {
        valor: 50,
        command: 50,
        numeracy: 50,
        learning: 50,
        charisma: 50,
        insight: 50,
      },
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 20,
      wealth: 0,
      attitudes: {},
    }
    const secondHouse: House = {
      id: secondHouseId,
      nameKey: 'H1',
      active: true,
      memberIds: [secondPersonId],
      deceasedMemberIds: [],
      founderId: secondPersonId,
      cadetHouseIds: [],
      legacyPrestige: 10,
      wealth: 10,
      seatProvinceId: 'p-0' as ProvinceId,
      kind: 'normal',
    }

    world.persons[secondPersonId] = secondPerson
    world.houses[secondHouseId] = secondHouse

    const ctx = makeCtx(world)
    const result = extinctHouse(ctx, {
      houseId: targetHouseId,
      affectedPolityIds: [],
    })

    expect(result.ok).toBe(true)
    // With multiple normal houses, extinction should proceed without guard
    // We just verify the system ran without throwing
  })
})
