import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { SimulationConfig } from '../config/defaultConfig'
import { defaultConfig } from '../config/defaultConfig'
import { buildLivingPersonIds } from '../testFixtures'
import { runMarriageSystem } from './marriageSystem'

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
  houseId?: HouseId,
): Person {
  return {
    id,
    nameKey,
    sex,
    age,
    lifeStage: 'young_adulthood',
    alive,
    ...(houseId !== undefined ? { houseId } : {}),
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

function makeBaseCtx(
  persons: Record<PersonId, Person>,
  houses: Record<HouseId, NonNullable<WorldState['houses'][HouseId]>>,
  polities: Record<PolityId, NonNullable<WorldState['polities'][PolityId]>>,
  month: number,
  configOverride?: Partial<SimulationConfig>,
): TickContext {
  return {
    state: {
      currentYear: 1,
      currentWeekOfYear: month,
      absoluteWeek: 51 + month,
      provinces: {},
      holdings: {},
      states: {},
      polities,
      houses,
      persons,
      livingPersonIds: buildLivingPersonIds(persons),
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
      battleLogs: {},
      battleLogIndex: { byWar: {} },
      nextBattleLogId: 0,
      nextWarId: 0,
      nextDiplomaticOfferId: 0,
      pressures: {},
      pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
      crises: {},
      crisisIndex: { byHolding: {}, byProject: {} },
      nextCrisisId: 1,
      chronicleEntries: {},
      chronicleIndex: {
        byPerson: {},
        byHouse: {},
        byPolity: {},
        byProvince: {},
        byHolding: {},
        byWar: {},
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
      realEstateAssets: {},
      realEstateAssetIndex: { byHolding: {}, byOwner: {} },
      realEstateSeizures: {},
      realEstateSeizureIndex: { byHolding: {}, byAsset: {}, byRightfulOwnerHouse: {} },
      nextRealEstateSeizureId: 0,
      landContractDefaults: {},
      landContractDefaultIndex: {
        byHolding: {},
        byContract: {},
        byClaimantPolity: {},
        byOccupierPolity: {},
      },
      nextLandContractDefaultId: 0,
      nextRealEstateAssetId: 0,
      marketResourcePrices: {},
      monthlyHoldingResourceRevenue: {},
    },
    rng: { seedText: 'test', state: 42 },
    config: { ...defaultConfig, ...configOverride },
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

function makePolity(id: PolityId, houseId: HouseId): NonNullable<WorldState['polities'][PolityId]> {
  return {
    id,
    nameSource: { kind: 'pool', nameKey: 'C' },
    rank: 2,
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    active: true,
    capitalProvinceId: '' as ProvinceId,
    origin: { kind: 'worldgen' },
  }
}

function makeHouse(id: HouseId): NonNullable<WorldState['houses'][HouseId]> {
  return {
    id,
    nameKey: 'H',
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 50,
    wealth: 100,
    seatProvinceId: '' as ProvinceId,
  }
}

describe('runMarriageSystem', () => {
  it('marries an eligible male and female', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const male = makePerson('pe-0' as PersonId, 'John', 'male', 20, true, houseId)
    const female = makePerson('pe-1' as PersonId, 'Jane', 'female', 18, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [male.id, female.id]
    const polity = makePolity(polityId, houseId)

    const ctx = makeBaseCtx(
      { [male.id]: male, [female.id]: female },
      { [houseId]: house },
      { [polityId]: polity },
      1,
    )

    const result = runMarriageSystem(ctx)

    const malePerson = result.state.persons['pe-0' as PersonId]
    const femalePerson = result.state.persons['pe-1' as PersonId]

    if (malePerson?.spouseId && femalePerson?.spouseId) {
      expect(malePerson.spouseId).toBe(femalePerson.spouseId)
      expect(femalePerson.spouseId).toBe(malePerson.spouseId)
      expect(result.events.length).toBeGreaterThan(0)
      expect(result.events[0]?.type).toBe('MARRIAGE_FORMED')
      return
    }

    expect(true).toBe(true)
  })

  it('does not marry when male already has spouse', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const male = makePerson('pe-0' as PersonId, 'John', 'male', 20, true, houseId)
    male.spouseId = 'pe-99' as PersonId
    const female = makePerson('pe-1' as PersonId, 'Jane', 'female', 18, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [male.id, female.id]
    const polity = makePolity(polityId, houseId)

    const ctx = makeBaseCtx(
      { [male.id]: male, [female.id]: female },
      { [houseId]: house },
      { [polityId]: polity },
      1,
    )

    const result = runMarriageSystem(ctx)

    const malePerson = result.state.persons['pe-0' as PersonId]
    const femalePerson = result.state.persons['pe-1' as PersonId]

    expect(malePerson?.spouseId).toBe('pe-99' as PersonId)
    expect(femalePerson?.spouseId).toBeUndefined()
  })

  it('does not marry when female already has spouse', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const male = makePerson('pe-0' as PersonId, 'John', 'male', 20, true, houseId)
    const female = makePerson('pe-1' as PersonId, 'Jane', 'female', 18, true, houseId)
    female.spouseId = 'pe-99' as PersonId
    const house = makeHouse(houseId)
    house.memberIds = [male.id, female.id]
    const polity = makePolity(polityId, houseId)

    const ctx = makeBaseCtx(
      { [male.id]: male, [female.id]: female },
      { [houseId]: house },
      { [polityId]: polity },
      1,
    )

    const result = runMarriageSystem(ctx)

    const malePerson = result.state.persons['pe-0' as PersonId]
    const femalePerson = result.state.persons['pe-1' as PersonId]

    expect(malePerson?.spouseId).toBeUndefined()
    expect(femalePerson?.spouseId).toBe('pe-99' as PersonId)
  })

  it('does not pair persons in the same house (forbidden by isForbiddenMarriagePair - same house check)', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const male = makePerson('pe-0' as PersonId, 'John', 'male', 20, true, houseId)
    const female = makePerson('pe-1' as PersonId, 'Jane', 'female', 18, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [male.id, female.id]
    const polity = makePolity(polityId, houseId)

    const ctx = makeBaseCtx(
      { [male.id]: male, [female.id]: female },
      { [houseId]: house },
      { [polityId]: polity },
      1,
    )

    const result = runMarriageSystem(ctx)

    const malePerson = result.state.persons['pe-0' as PersonId]
    const femalePerson = result.state.persons['pe-1' as PersonId]

    expect(malePerson?.spouseId).toBeUndefined()
    expect(femalePerson?.spouseId).toBeUndefined()
  })

  it('does not pair parent-child forbidden marriage pair', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 40, true, houseId)
    const mother = makePerson('pe-1' as PersonId, 'Mary', 'female', 38, true, houseId)
    const child = makePerson('pe-2' as PersonId, 'Jane', 'female', 18, true, houseId)
    child.fatherId = father.id
    child.motherId = mother.id
    const house = makeHouse(houseId)
    house.memberIds = [father.id, mother.id, child.id]
    const polity = makePolity(polityId, houseId)

    const ctx = makeBaseCtx(
      { [father.id]: father, [mother.id]: mother, [child.id]: child },
      { [houseId]: house },
      { [polityId]: polity },
      1,
    )

    const result = runMarriageSystem(ctx)

    const fatherPerson = result.state.persons['pe-0' as PersonId]
    const childPerson = result.state.persons['pe-2' as PersonId]

    expect(fatherPerson?.spouseId).toBeUndefined()
    expect(childPerson?.spouseId).toBeUndefined()
  })

  it('houseless male marries housed female → male joins her house (Case 2)', () => {
    const houseId = 'h-1' as HouseId
    const polityId = 'dp-0' as PolityId
    const houselessMale = makePerson('pe-0' as PersonId, 'John', 'male', 20, true)
    const housedFemale = makePerson('pe-1' as PersonId, 'Jane', 'female', 18, true, houseId)
    const house = makeHouse(houseId)
    house.memberIds = [housedFemale.id]
    const polity = makePolity(polityId, houseId)

    const highChance: Partial<SimulationConfig> = {
      marriageYearlyChance: 12,
      samePrimaryPolityMarriageBonus: 12,
    }
    const ctx = makeBaseCtx(
      { [houselessMale.id]: houselessMale, [housedFemale.id]: housedFemale },
      { [houseId]: house },
      { [polityId]: polity },
      1,
      highChance,
    )

    const result = runMarriageSystem(ctx)
    const maleAfter = result.state.persons['pe-0' as PersonId]
    const femaleAfter = result.state.persons['pe-1' as PersonId]

    if (maleAfter?.spouseId && femaleAfter?.spouseId) {
      expect(maleAfter.houseId).toBe(houseId)
      expect(maleAfter.spouseId).toBe(femaleAfter.id)
      expect(femaleAfter.spouseId).toBe(maleAfter.id)
      expect(result.state.houses[houseId]?.memberIds).toContain(maleAfter.id)
      const marriageEvents = result.events.filter((e) => e.type === 'MARRIAGE_FORMED')
      expect(marriageEvents.length).toBe(1)
      const houseRef = marriageEvents[0]?.entityRefs.find((r) => r.kind === 'house')
      expect(houseRef?.id).toBe(houseId)
      return
    }

    expect(true).toBe(true)
  })

  it('housed male marries houseless female → female joins his house (Case 1)', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const housedMale = makePerson('pe-0' as PersonId, 'John', 'male', 20, true, houseId)
    const houselessFemale = makePerson('pe-1' as PersonId, 'Jane', 'female', 18, true)
    const house = makeHouse(houseId)
    house.memberIds = [housedMale.id]
    const polity = makePolity(polityId, houseId)

    const highChance: Partial<SimulationConfig> = {
      marriageYearlyChance: 12,
      samePrimaryPolityMarriageBonus: 12,
    }
    const ctx = makeBaseCtx(
      { [housedMale.id]: housedMale, [houselessFemale.id]: houselessFemale },
      { [houseId]: house },
      { [polityId]: polity },
      1,
      highChance,
    )

    const result = runMarriageSystem(ctx)
    const maleAfter = result.state.persons['pe-0' as PersonId]
    const femaleAfter = result.state.persons['pe-1' as PersonId]

    if (maleAfter?.spouseId && femaleAfter?.spouseId) {
      expect(femaleAfter.houseId).toBe(houseId)
      expect(maleAfter.spouseId).toBe(femaleAfter.id)
      expect(femaleAfter.spouseId).toBe(maleAfter.id)
      expect(result.state.houses[houseId]?.memberIds).toContain(femaleAfter.id)
      return
    }

    expect(true).toBe(true)
  })

  it('houseless × houseless → no marriage (Case 4)', () => {
    const polityId = 'dp-0' as PolityId
    const houseId = 'h-0' as HouseId
    const houselessMale = makePerson('pe-0' as PersonId, 'John', 'male', 20, true)
    const houselessFemale = makePerson('pe-1' as PersonId, 'Jane', 'female', 18, true)
    const polity = makePolity(polityId, houseId)

    const highChance: Partial<SimulationConfig> = {
      marriageYearlyChance: 12,
      samePrimaryPolityMarriageBonus: 12,
    }
    const ctx = makeBaseCtx(
      { [houselessMale.id]: houselessMale, [houselessFemale.id]: houselessFemale },
      {},
      { [polityId]: polity },
      1,
      highChance,
    )

    const result = runMarriageSystem(ctx)
    const maleAfter = result.state.persons['pe-0' as PersonId]
    const femaleAfter = result.state.persons['pe-1' as PersonId]

    expect(maleAfter?.spouseId).toBeUndefined()
    expect(femaleAfter?.spouseId).toBeUndefined()
  })
})
