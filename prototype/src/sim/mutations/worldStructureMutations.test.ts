import { describe, it, expect } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from '../tick/context'
import type { WorldState } from '../types/world'
import type { HouseId, ProvinceId, PolityId, PersonId } from '../types/ids'
import type { Province } from '../types/province'
import type { House } from '../types/house'
import type { Person } from '../types/person'
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'
import { extinctHouse } from './worldStructureMutations'

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
    name: 'TestPerson',
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
    name: 'H0',
    active: true,
    memberIds: [personId],
    founderId: personId,
    cadetHouseIds: [],
    legacyPrestige: 50,
    wealth: 100,
    seatProvinceId: provinceId,
    kind: 'normal',
  }

  const polity = {
    id: polityId,
    name: 'C0',
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
    name: 'Capital',
    x: 0,
    y: 0,
    habitability: 50,
    development: 50,
    neighbors: [],
    polityControl: 0,
    popGroupIds: [],
  }

  const anonHouse: House = {
    id: ANONYMOUS_HOUSE_ID,
    name: 'Anonymous',
    active: true,
    memberIds: [],
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
    absoluteWeek: 52,
    provinces: { [provinceId]: province },
    polities: { [polityId]: polity },
    houses: { [houseId]: house, [ANONYMOUS_HOUSE_ID]: anonHouse },
    persons: { [personId]: person },
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContracts: {},
    provinceOfficeAssignments: {},
    landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
    provinceTerminalPolityCache: {},
    provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextLandContractId: 0,
    nextProvinceOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    actorIntents: {},
    diplomaticPlays: {},
    nextActorIntentId: 0,
    nextDiplomaticPlayId: 0,
  }
}

describe('handleNormalHouseExtinction — last-normal-house guard', () => {
  it('single normal house + AnonymousHouse → house remains active (guard triggered)', () => {
    const world = makeMinimalWorld()
    const normalHouseId = 'h-0' as HouseId

    expect(world.houses[normalHouseId]?.active).toBe(true)
    expect(world.houses[ANONYMOUS_HOUSE_ID]?.kind).toBe('system')

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
      name: 'SecondPerson',
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
      name: 'H1',
      active: true,
      memberIds: [secondPersonId],
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
