import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import { defaultConfig } from '../config/defaultConfig'
import { runBirthSystem } from './birthSystem'
import { makeEmptyV016State } from '../testFixtures'

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
    lifeStage: 'young_adulthood',
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
    nameSource: { kind: 'pool', nameKey: 'C' },
    rank: 2,
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    active: true,
    capitalProvinceId: provId,
    origin: { kind: 'worldgen' },
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
        livingPersonIds: ['pe-0' as PersonId, 'pe-1' as PersonId],
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
        influenceModifiers: {},
        influenceModifierIndex: { byPolity: {}, byTarget: {} },
        nextInfluenceModifierId: 0,
        officeAssignments: {},
        houseShareIndex: { byHouse: {}, byHolderPerson: {} },
        officeIndex: { byOrganization: {}, byHolderPerson: {} },
        nextHouseShareId: 0,
        nextOfficeAssignmentId: 0,
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
        livingPersonIds: ['pe-0' as PersonId],
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
        influenceModifiers: {},
        influenceModifierIndex: { byPolity: {}, byTarget: {} },
        nextInfluenceModifierId: 0,
        officeAssignments: {},
        houseShareIndex: { byHouse: {}, byHolderPerson: {} },
        officeIndex: { byOrganization: {}, byHolderPerson: {} },
        nextHouseShareId: 0,
        nextOfficeAssignmentId: 0,
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
        livingPersonIds: ['pe-0' as PersonId, 'pe-1' as PersonId],
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
        influenceModifiers: {},
        influenceModifierIndex: { byPolity: {}, byTarget: {} },
        nextInfluenceModifierId: 0,
        officeAssignments: {},
        houseShareIndex: { byHouse: {}, byHolderPerson: {} },
        officeIndex: { byOrganization: {}, byHolderPerson: {} },
        nextHouseShareId: 0,
        nextOfficeAssignmentId: 0,
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

  it('population multiplier applies when living persons <= baseline × criticalLivingPersonsFactor', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [father.id]
    const polity = makePolity(polityId, houseId)

    // v0.45.1: baseline 10 × criticalLivingPersonsFactor 1.0 = 10 ≧ living 1 → critical 帯
    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 0.3,
      criticalLivingPersonsFactor: 1.0,
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
          livingPersonIds: ['pe-0' as PersonId],
          worldgenLivingPersonsBaseline: 10,
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
          influenceModifiers: {},
          influenceModifierIndex: { byPolity: {}, byTarget: {} },
          nextInfluenceModifierId: 0,
          officeAssignments: {},
          houseShareIndex: { byHouse: {}, byHolderPerson: {} },
          officeIndex: { byOrganization: {}, byHolderPerson: {} },
          nextHouseShareId: 0,
          nextOfficeAssignmentId: 0,
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
          chronicleIndex: {
            byPerson: {},
            byHouse: {},
            byPolity: {},
            byProvince: {},
            byHolding: {},
          },
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

    // v0.45.1: baseline 未設定 (state に worldgenLivingPersonsBaseline なし) = 倍率制御無効 (常に 1.0)
    const normalConfig = makeConfig({
      baseBirthChancePerMalePerYear: 0.3,
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
          livingPersonIds: ['pe-0' as PersonId],
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
          influenceModifiers: {},
          influenceModifierIndex: { byPolity: {}, byTarget: {} },
          nextInfluenceModifierId: 0,
          officeAssignments: {},
          houseShareIndex: { byHouse: {}, byHolderPerson: {} },
          officeIndex: { byOrganization: {}, byHolderPerson: {} },
          nextHouseShareId: 0,
          nextOfficeAssignmentId: 0,
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
          chronicleIndex: {
            byPerson: {},
            byHouse: {},
            byPolity: {},
            byProvince: {},
            byHolding: {},
          },
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

// ─── v0.45.4 adultMaleShortageThreshold ───

describe('adultMaleShortageThreshold (v0.45.4)', () => {
  // 成人男性 1 / 総人口 4 (= 25% < 0.4) の「男性不足」状態を作り、
  // maleBirthChance=0 / boost=1 の両極設定で「どちらの確率が使われたか」を子の性別で判定する
  function runShortageScenario(threshold: number): 'male' | 'female' {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId)
    const f1 = makePerson('pe-1' as PersonId, 'A', 'female', 30, true, houseId)
    const f2 = makePerson('pe-2' as PersonId, 'B', 'female', 30, true, houseId)
    const f3 = makePerson('pe-3' as PersonId, 'C', 'female', 30, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [father.id, f1.id, f2.id, f3.id]
    const polity = makePolity(polityId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 12.0, // 1 call あたり確率 1.0 = 必ず出生
      spouseMotherChance: 0,
      maleBirthChance: 0, // base が使われれば必ず female
      maleBirthChanceWhenAdultMaleShortage: 1, // boost が使われれば必ず male
      adultMaleShortageThreshold: threshold,
    })

    const base = makeEmptyV016State()
    const ctx: TickContext = {
      state: {
        ...base,
        currentYear: 1,
        currentWeekOfYear: 1,
        absoluteWeek: 48,
        polities: { [polityId]: polity },
        houses: { [houseId]: house },
        persons: {
          [father.id]: father,
          [f1.id]: f1,
          [f2.id]: f2,
          [f3.id]: f3,
        },
        livingPersonIds: [father.id, f1.id, f2.id, f3.id],
      },
      rng: { seedText: 'shortage-test', state: 7 },
      config: customConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 4,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const result = runBirthSystem(ctx)
    const childKey = Object.keys(result.state.persons).find((k) => !k.match(/^pe-[0-3]$/))
    expect(childKey).toBeDefined()
    return result.state.persons[childKey as PersonId]!.sex
  }

  it('threshold 0.4: 男性不足コントローラが発動し boost 値が使われる', () => {
    expect(runShortageScenario(0.4)).toBe('male')
  })

  it('threshold 0: コントローラ無効で base maleBirthChance が使われる (女性多めプレイ)', () => {
    expect(runShortageScenario(0)).toBe('female')
  })
})
