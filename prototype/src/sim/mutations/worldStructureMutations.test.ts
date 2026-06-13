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
    lifeStage: 'young_adulthood',
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
    nameSource: { kind: 'pool' as const, nameKey: 'C0' },
    rank: 2 as const,
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    active: true,
    capitalProvinceId: provinceId,
    origin: { kind: 'worldgen' },
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
    houseShares: {},
    politicalRights: {},
    politicalRightIndex: { byPolity: {}, byHolder: {}, byTarget: {} },
    nextPoliticalRightId: 0,
    personReputations: {},
    personReputationIndex: { byPerson: {}, byOrganization: {} },
    nextPersonReputationId: 0,
    officeAssignments: {},
    houseShareIndex: { byHouse: {}, byHolderPerson: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {}, byPolity: {}, byParent: {} },
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    nextHouseShareId: 0,
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
    regiments: {},
    regimentIndex: { byOwner: {}, byWar: {}, byHomeProvince: {}, byHomeHolding: {} },
    nextRegimentId: 0,
    battles: {},
    battleIndex: { byWar: {} },
    nextBattleId: 0,
    nextWarId: 0,
    nextDiplomaticOfferId: 0,
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    chronicleEntries: {},
    chronicleIndex: { byPerson: {}, byHouse: {}, byPolity: {}, byProvince: {}, byHolding: {} },
    nextChronicleEntryId: 0,
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
      lifeStage: 'young_adulthood',
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

describe('handleNormalHouseExtinction — 分家優先継承 + wealth 継承', () => {
  const EXT = 'h-ext' as HouseId
  const P1 = 'dp-1' as PolityId
  const P2 = 'dp-2' as PolityId
  const P3 = 'dp-3' as PolityId

  // 断絶家 EXT が 3 Polity (P1/P2/P3) と wealth 300 を持ち、active な分家 cadetIds を持つ world。
  function makeKinWorld(cadetIds: HouseId[]): WorldState {
    const base = makeMinimalWorld()
    const prov = 'p-0' as ProvinceId
    const founder = 'pe-0' as PersonId
    const baseP = base.polities['dp-0' as PolityId]!
    const mkHouse = (id: HouseId, cadets: HouseId[], wealth: number): House => ({
      id,
      nameKey: id,
      active: true,
      memberIds: [],
      deceasedMemberIds: [],
      founderId: founder,
      cadetHouseIds: cadets,
      legacyPrestige: 50,
      wealth,
      seatProvinceId: prov,
      kind: 'normal',
    })
    const mkPolity = (id: PolityId) => ({ ...baseP, id, ownerHouseId: EXT })
    const houses: Record<string, House> = {
      [EXT]: mkHouse(EXT, cadetIds, 300),
      [HOUSELESS_HOUSE_ID]: base.houses[HOUSELESS_HOUSE_ID]!,
    }
    for (const c of cadetIds) houses[c] = mkHouse(c, [], 0)
    return {
      ...base,
      houses,
      polities: { [P1]: mkPolity(P1), [P2]: mkPolity(P2), [P3]: mkPolity(P3) },
      polityIndex: { byOwnerHouse: { [EXT]: [P1, P2, P3] } },
    }
  }

  it('複数分家 → Polity を round-robin 分散・wealth を受領 Polity 数で按分', () => {
    const c1 = 'h-c1' as HouseId
    const c2 = 'h-c2' as HouseId
    const result = extinctHouse(makeCtx(makeKinWorld([c1, c2])), {
      houseId: EXT,
      affectedPolityIds: [P1, P2, P3],
    })
    if (!result.ok) throw new Error(`extinctHouse failed: ${result.error.message}`)
    const s = result.value.ctx.state
    // cadetHeirs は houseId 昇順 [h-c1, h-c2]、byOwnerHouse 順 [P1,P2,P3] を i%2 で巡回割当
    expect(s.polities[P1]?.ownerHouseId).toBe(c1)
    expect(s.polities[P2]?.ownerHouseId).toBe(c2)
    expect(s.polities[P3]?.ownerHouseId).toBe(c1)
    // wealth 300 を受領数で按分: c1=2/3→200, c2=1/3→100、断絶家は 0
    expect(s.houses[c1]?.wealth).toBe(200)
    expect(s.houses[c2]?.wealth).toBe(100)
    expect(s.houses[EXT]?.wealth).toBe(0)
    expect(s.houses[EXT]?.active).toBe(false)
  })

  it('単一分家 → 全 Polity・全 wealth をその分家が継承（王朝が唯一の分家として存続）', () => {
    const c1 = 'h-c1' as HouseId
    const result = extinctHouse(makeCtx(makeKinWorld([c1])), {
      houseId: EXT,
      affectedPolityIds: [P1, P2, P3],
    })
    if (!result.ok) throw new Error(`extinctHouse failed: ${result.error.message}`)
    const s = result.value.ctx.state
    expect(s.polities[P1]?.ownerHouseId).toBe(c1)
    expect(s.polities[P2]?.ownerHouseId).toBe(c1)
    expect(s.polities[P3]?.ownerHouseId).toBe(c1)
    expect(s.houses[c1]?.wealth).toBe(300)
    expect(s.houses[EXT]?.wealth).toBe(0)
    expect(s.houses[EXT]?.active).toBe(false)
  })
})
