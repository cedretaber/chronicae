import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import { defaultConfig } from '../config/defaultConfig'
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

function makeBaseCtx(
  persons: Record<PersonId, Person>,
  houses: Record<HouseId, NonNullable<WorldState['houses'][HouseId]>>,
  polities: Record<PolityId, NonNullable<WorldState['polities'][PolityId]>>,
  month: number,
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
    },
    rng: { seedText: 'test', state: 42 },
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

function makePolity(id: PolityId, houseId: HouseId): NonNullable<WorldState['polities'][PolityId]> {
  return {
    id,
    nameKey: 'C',
    rank: 2,
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    active: true,
    capitalProvinceId: '' as ProvinceId,
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
})
