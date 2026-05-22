import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import { defaultConfig } from '../config/defaultConfig'
import { runBirthSystem } from './birthSystem'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(
  id: PersonId,
  nameKey: string,
  sex: 'male' | 'female',
  age: number,
  alive: boolean,
  houseId: HouseId,
): Person {
  return {
    id,
    nameKey,
    sex,
    age,
    alive,
    houseId,
    childIds: [],
    birthStatus: 'unknown',
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 10,
    wealth: 0,
    attitudes: {},
  }
}

function makePolity(
  id: PolityId,
  houseId: HouseId,
  provinceId?: ProvinceId,
): NonNullable<WorldState['polities'][PolityId]> {
  const provId = provinceId ?? ('p-0' as ProvinceId)
  return {
    id,
    nameKey: 'C',
    rank: 2,
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    active: true,
    capitalProvinceId: provId,
  }
}

function makeHouse(
  id: HouseId,
  provinceId?: ProvinceId,
): NonNullable<WorldState['houses'][HouseId]> {
  const provId = provinceId ?? ('p-0' as ProvinceId)
  return {
    id,
    nameKey: 'H',
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 50,
    wealth: 100,
    seatProvinceId: provId,
  }
}

function makeConfig(overrides: Partial<typeof defaultConfig> = {}): typeof defaultConfig {
  return { ...defaultConfig, ...overrides }
}

describe('runBirthSystem', () => {
  it('a father with a valid spouse produces a child', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId)
    const mother = makePerson('pe-1' as PersonId, 'Jane', 'female', 28, true, houseId)
    mother.spouseId = father.id
    father.spouseId = mother.id
    const house = makeHouse(houseId)
    house.memberIds = [father.id, mother.id]
    const polity = makePolity(polityId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 12.0,
      spouseMotherChance: 1.0,
    })

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentWeekOfYear: 1,
        absoluteWeek: 48,
        provinces: {},
        holdings: {},
        states: {},
        polities: { [polityId]: polity },
        houses: { [houseId]: house },
        persons: { [father.id]: father, [mother.id]: mother },
        activePlots: {},
        popGroups: {},
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
        nextLandContractId: 0,
        nextHoldingOfficeAssignmentId: 0,
        nextFactionId: 0,
        nextFactionMembershipId: 0,
        actorIntents: {},
        diplomaticPlays: {},
        nextActorIntentId: 0,
        nextDiplomaticPlayId: 0,
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
      },
      rng: { seedText: 'test', state: 42 },
      config: customConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 2,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const result = runBirthSystem(ctx)

    const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0' && k !== 'pe-1')
    expect(childKeys.length).toBeGreaterThan(0)

    if (childKeys.length > 0) {
      const childId = childKeys[0] as PersonId
      const child = result.state.persons[childId]
      expect(child).toBeDefined()
      expect(child?.fatherId).toBe('pe-0' as PersonId)
      expect(child?.birthStatus).toBe('legitimate')

      const fatherPerson = result.state.persons['pe-0' as PersonId]
      expect(fatherPerson?.childIds).toContain(childId)

      const motherPerson = result.state.persons['pe-1' as PersonId]
      expect(motherPerson?.childIds).toContain(childId)
    }
  })

  it('child born without spouse mother gets birthStatus illegitimate', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [father.id]
    const polity = makePolity(polityId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 12.0,
      spouseMotherChance: 0.0,
    })

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentWeekOfYear: 1,
        absoluteWeek: 48,
        provinces: {},
        holdings: {},
        states: {},
        polities: { [polityId]: polity },
        houses: { [houseId]: house },
        persons: { [father.id]: father },
        activePlots: {},
        popGroups: {},
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
        nextLandContractId: 0,
        nextHoldingOfficeAssignmentId: 0,
        nextFactionId: 0,
        nextFactionMembershipId: 0,
        actorIntents: {},
        diplomaticPlays: {},
        nextActorIntentId: 0,
        nextDiplomaticPlayId: 0,
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
      },
      rng: { seedText: 'test', state: 42 },
      config: customConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 2,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const result = runBirthSystem(ctx)

    const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0')
    expect(childKeys.length).toBeGreaterThan(0)

    if (childKeys.length > 0) {
      const childId = childKeys[0] as PersonId
      const child = result.state.persons[childId]
      expect(child?.birthStatus).toBe('illegitimate')
    }
  })

  it('child born to legitimate couple gets birthStatus legitimate', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId)
    const mother = makePerson('pe-1' as PersonId, 'Jane', 'female', 28, true, houseId)
    mother.spouseId = father.id
    father.spouseId = mother.id
    const house = makeHouse(houseId)
    house.memberIds = [father.id, mother.id]
    const polity = makePolity(polityId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 12.0,
      spouseMotherChance: 1.0,
    })

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentWeekOfYear: 1,
        absoluteWeek: 48,
        provinces: {},
        holdings: {},
        states: {},
        polities: { [polityId]: polity },
        houses: { [houseId]: house },
        persons: { [father.id]: father, [mother.id]: mother },
        activePlots: {},
        popGroups: {},
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
        nextLandContractId: 0,
        nextHoldingOfficeAssignmentId: 0,
        nextFactionId: 0,
        nextFactionMembershipId: 0,
        actorIntents: {},
        diplomaticPlays: {},
        nextActorIntentId: 0,
        nextDiplomaticPlayId: 0,
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
      },
      rng: { seedText: 'test', state: 42 },
      config: customConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 2,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const result = runBirthSystem(ctx)

    const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0' && k !== 'pe-1')
    expect(childKeys.length).toBeGreaterThan(0)

    if (childKeys.length > 0) {
      const childId = childKeys[0] as PersonId
      const child = result.state.persons[childId]
      expect(child?.birthStatus).toBe('legitimate')
    }
  })

  it('population multiplier applies when living persons <= criticalLivingPersons', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [father.id]
    const polity = makePolity(polityId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 0.3,
      criticalLivingPersons: 10,
      criticalPopulationBirthMultiplier: 3.0,
    })

    let birthsWithLowPop = 0
    let birthsNormalPop = 0

    for (let i = 0; i < 50; i++) {
      const ctx: TickContext = {
        state: {
          currentYear: 1,
          currentWeekOfYear: 1,
          absoluteWeek: 48,
          provinces: {},
          holdings: {},
          states: {},
          polities: { [polityId]: polity },
          houses: { [houseId]: house },
          persons: { [father.id]: { ...father } },
          activePlots: {},
          popGroups: {},
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
          nextLandContractId: 0,
          nextHoldingOfficeAssignmentId: 0,
          nextFactionId: 0,
          nextFactionMembershipId: 0,
          actorIntents: {},
          diplomaticPlays: {},
          nextActorIntentId: 0,
          nextDiplomaticPlayId: 0,
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
        },
        rng: { seedText: 'low-pop-' + i, state: 42 + i },
        config: customConfig,
        events: [],
        nextEventIndex: 0,
        deathsThisTick: [],
        deathRolesThisTick: {},
        nextPersonIndex: 1,
        nextHouseIndex: 0,
        nextPolityIndex: 0,
      }

      const result = runBirthSystem(ctx)
      const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0')
      if (childKeys.length > 0) birthsWithLowPop++
    }

    const normalConfig = makeConfig({
      baseBirthChancePerMalePerYear: 0.3,
      criticalLivingPersons: 0,
      targetLivingPersons: 0,
      criticalPopulationBirthMultiplier: 1.0,
      lowPopulationBirthMultiplier: 1.0,
    })

    for (let i = 0; i < 50; i++) {
      const ctx: TickContext = {
        state: {
          currentYear: 1,
          currentWeekOfYear: 1,
          absoluteWeek: 48,
          provinces: {},
          holdings: {},
          states: {},
          polities: { [polityId]: polity },
          houses: { [houseId]: house },
          persons: { [father.id]: { ...father } },
          activePlots: {},
          popGroups: {},
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
          nextLandContractId: 0,
          nextHoldingOfficeAssignmentId: 0,
          nextFactionId: 0,
          nextFactionMembershipId: 0,
          actorIntents: {},
          diplomaticPlays: {},
          nextActorIntentId: 0,
          nextDiplomaticPlayId: 0,
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
        },
        rng: { seedText: 'normal-pop-' + i, state: 42 + i },
        config: normalConfig,
        events: [],
        nextEventIndex: 0,
        deathsThisTick: [],
        deathRolesThisTick: {},
        nextPersonIndex: 1,
        nextHouseIndex: 0,
        nextPolityIndex: 0,
      }

      const result = runBirthSystem(ctx)
      const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0')
      if (childKeys.length > 0) birthsNormalPop++
    }

    expect(birthsWithLowPop).toBeGreaterThan(birthsNormalPop)
  })
})
