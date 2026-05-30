import { describe, expect, it } from 'vitest'
import { createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { House } from '../types/house'
import type { Person } from '../types/person'
import type { WorldState } from '../types/world'
import { buildLivingPersonIds } from '../testFixtures'
import { defaultConfig, type SimulationConfig } from '../config/defaultConfig'
import {
  needsSuccession,
  getAdultSuccessionCandidates,
  getMinorSuccessionCandidates,
  getBloodScore,
  calcSuccessionScore,
  chooseSuccessor,
  type SuccessionCandidate,
} from './successionSelectors'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(overrides: Partial<Person> = {}): Person {
  const id = overrides.id ?? createPersonId('pe', 0)
  const houseId = overrides.houseId ?? createHouseId('h', 0)
  return {
    id,
    nameKey: 'Person',
    sex: 'male',
    age: 30,
    alive: true,
    houseId,
    childIds: [],
    birthStatus: 'unknown',
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 50,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
}

function makeHouse(memberIds: Person[], overrides: Partial<House> = {}): House {
  const houseId = overrides.id ?? createHouseId('h', 0)
  return {
    id: houseId,
    nameKey: 'House',
    active: true,
    memberIds: memberIds.map((p) => p.id),
    deceasedMemberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 50,
    wealth: 0,
    seatProvinceId: createProvinceId('pr', 0),
    ...overrides,
  }
}

function makeState(persons: Record<string, Person>, houses: Record<string, House>): WorldState {
  return {
    currentYear: 1444,
    absoluteWeek: 69312,
    currentWeekOfYear: 1,
    provinces: {},
    holdings: {},
    states: {},
    polities: {},
    houses,
    persons,
    livingPersonIds: buildLivingPersonIds(persons),
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
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
  }
}

const testConfig: SimulationConfig = { ...defaultConfig }

describe('needsSuccession', () => {
  it('returns true when house is active and head is dead', () => {
    const head = makePerson({ id: createPersonId('pe', 0), alive: false })
    const house = makeHouse([head])
    const state = makeState({ [head.id]: head }, { [house.id]: house })
    expect(needsSuccession(state, house)).toBe(true)
  })

  it('returns false when house is active and head is alive', () => {
    const head = makePerson({ id: createPersonId('pe', 0), alive: true })
    const house = makeHouse([head])
    const officeId = 'of-0' as import('../types/ids').OfficeAssignmentId
    const state: WorldState = {
      ...makeState({ [head.id]: head }, { [house.id]: house }),
      officeAssignments: {
        [officeId]: {
          id: officeId,
          organization: { kind: 'house' as const, id: house.id },
          role: 'leader' as const,
          holderPersonId: head.id,
          active: true,
          startYear: 1444,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: { [`house:${house.id}`]: [officeId] },
        byHolderPerson: { [head.id]: [officeId] },
      },
    }
    expect(needsSuccession(state, house)).toBe(false)
  })

  it('returns false when house is inactive', () => {
    const head = makePerson({ id: createPersonId('pe', 0), alive: false })
    const house = makeHouse([head], { active: false })
    const state = makeState({ [head.id]: head }, { [house.id]: house })
    expect(needsSuccession(state, house)).toBe(false)
  })
})

describe('getAdultSuccessionCandidates', () => {
  it('returns only alive adults', () => {
    const head = makePerson({ id: createPersonId('pe', 0), alive: false })
    const adult1 = makePerson({
      id: createPersonId('pe', 1),
      age: 20,
      alive: true,
      sex: 'male',
      houseId: head.houseId,
    } as Partial<Person>)
    const adult2 = makePerson({
      id: createPersonId('pe', 2),
      age: 10,
      alive: true,
      sex: 'male',
      houseId: head.houseId,
    } as Partial<Person>)
    const deadMember = makePerson({
      id: createPersonId('pe', 3),
      age: 40,
      alive: false,
      sex: 'male',
      houseId: head.houseId,
    } as Partial<Person>)
    const house = makeHouse([head, adult1, adult2, deadMember])
    const state = makeState(
      { [head.id]: head, [adult1.id]: adult1, [adult2.id]: adult2, [deadMember.id]: deadMember },
      { [house.id]: house },
    )
    const result = getAdultSuccessionCandidates(state, house, testConfig)
    expect(result.map((c) => c.person.id)).toEqual([adult1.id])
  })

  it('prefers adult males first when allowFemaleHouseHeadWhenNoMaleHeir is true', () => {
    const head = makePerson({ id: createPersonId('pe', 0), alive: false })
    const adultMale = makePerson({
      id: createPersonId('pe', 1),
      age: 20,
      alive: true,
      sex: 'male',
      houseId: head.houseId,
    } as Partial<Person>)
    const adultFemale = makePerson({
      id: createPersonId('pe', 2),
      age: 25,
      alive: true,
      sex: 'female',
      houseId: head.houseId,
    } as Partial<Person>)
    const house = makeHouse([head, adultMale, adultFemale])
    const state = makeState(
      { [head.id]: head, [adultMale.id]: adultMale, [adultFemale.id]: adultFemale },
      { [house.id]: house },
    )
    const result = getAdultSuccessionCandidates(state, house, testConfig)
    expect(result.map((c) => c.person.id)).toContain(adultMale.id)
  })

  it('includes females when no adult males and allowFemaleHouseHeadWhenNoMaleHeir is true', () => {
    const head = makePerson({ id: createPersonId('pe', 0), alive: false })
    const adultFemale = makePerson({
      id: createPersonId('pe', 1),
      age: 25,
      alive: true,
      sex: 'female',
      houseId: head.houseId,
    } as Partial<Person>)
    const house = makeHouse([head, adultFemale])
    const state = makeState(
      { [head.id]: head, [adultFemale.id]: adultFemale },
      { [house.id]: house },
    )
    const result = getAdultSuccessionCandidates(state, house, testConfig)
    expect(result.map((c) => c.person.id)).toContain(adultFemale.id)
  })

  it('excludes females when allowFemaleHouseHeadWhenNoMaleHeir is false', () => {
    const config = { ...testConfig, allowFemaleHouseHeadWhenNoMaleHeir: false }
    const head = makePerson({ id: createPersonId('pe', 0), alive: false })
    const adultFemale = makePerson({
      id: createPersonId('pe', 1),
      age: 25,
      alive: true,
      sex: 'female',
      houseId: head.houseId,
    } as Partial<Person>)
    const house = makeHouse([head, adultFemale])
    const state = makeState(
      { [head.id]: head, [adultFemale.id]: adultFemale },
      { [house.id]: house },
    )
    const result = getAdultSuccessionCandidates(state, house, config)
    expect(result.length).toBe(0)
  })

  it('excludes dead head from candidates', () => {
    const head = makePerson({ id: createPersonId('pe', 0), age: 50, alive: false })
    const house = makeHouse([head])
    const state = makeState({ [head.id]: head }, { [house.id]: house })
    const result = getAdultSuccessionCandidates(state, house, testConfig)
    expect(result.length).toBe(0)
  })
})

describe('getMinorSuccessionCandidates', () => {
  it('returns only alive persons under adultAge, sorted oldest first', () => {
    const head = makePerson({ id: createPersonId('pe', 0), alive: false })
    const minor1 = makePerson({
      id: createPersonId('pe', 1),
      age: 12,
      alive: true,
      houseId: head.houseId,
    } as Partial<Person>)
    const minor2 = makePerson({
      id: createPersonId('pe', 2),
      age: 8,
      alive: true,
      houseId: head.houseId,
    } as Partial<Person>)
    const deadMinor = makePerson({
      id: createPersonId('pe', 3),
      age: 10,
      alive: false,
      houseId: head.houseId,
    } as Partial<Person>)
    const house = makeHouse([head, minor1, minor2, deadMinor])
    const state = makeState(
      { [head.id]: head, [minor1.id]: minor1, [minor2.id]: minor2, [deadMinor.id]: deadMinor },
      { [house.id]: house },
    )
    const result = getMinorSuccessionCandidates(state, house, testConfig)
    expect(result.map((p) => p.id)).toEqual([minor1.id, minor2.id])
  })
})

describe('getBloodScore', () => {
  it('returns 100 for child of dead head', () => {
    const child = makePerson({ id: createPersonId('pe', 1), childIds: [] })
    const deadHead = makePerson({ id: createPersonId('pe', 0), childIds: [child.id] })
    const state = makeState({ [deadHead.id]: deadHead, [child.id]: child }, {})
    expect(getBloodScore(child, deadHead, state)).toBe(100)
  })

  it('returns 85 for grandchild of dead head', () => {
    const grandchild = makePerson({ id: createPersonId('pe', 2), childIds: [] })
    const child = makePerson({ id: createPersonId('pe', 1), childIds: [grandchild.id] })
    const deadHead = makePerson({ id: createPersonId('pe', 0), childIds: [child.id] })
    const state = makeState(
      { [deadHead.id]: deadHead, [child.id]: child, [grandchild.id]: grandchild },
      {},
    )
    expect(getBloodScore(grandchild, deadHead, state)).toBe(85)
  })

  it('returns 75 for sibling via father', () => {
    const fatherId = createPersonId('pe', 0)
    const sibling1 = makePerson({ id: createPersonId('pe', 1), fatherId, childIds: [] })
    const sibling2 = makePerson({ id: createPersonId('pe', 2), fatherId, childIds: [] })
    const state = makeState({ [sibling1.id]: sibling1, [sibling2.id]: sibling2 }, {})
    expect(getBloodScore(sibling1, sibling2, state)).toBe(75)
  })

  it('returns 75 for sibling via mother', () => {
    const motherId = createPersonId('pe', 0)
    const sibling1 = makePerson({ id: createPersonId('pe', 1), motherId, childIds: [] })
    const sibling2 = makePerson({ id: createPersonId('pe', 2), motherId, childIds: [] })
    const state = makeState({ [sibling1.id]: sibling1, [sibling2.id]: sibling2 }, {})
    expect(getBloodScore(sibling1, sibling2, state)).toBe(75)
  })

  it('returns 60 for nephew/uncle relationship', () => {
    const grandfather = makePerson({ id: createPersonId('pe', 0), childIds: [] })
    const uncle = makePerson({
      id: createPersonId('pe', 1),
      fatherId: createPersonId('pe', 0),
      childIds: [],
    })
    const nephew = makePerson({
      id: createPersonId('pe', 2),
      fatherId: createPersonId('pe', 1),
      childIds: [],
    })
    const state = makeState(
      { [grandfather.id]: grandfather, [uncle.id]: uncle, [nephew.id]: nephew },
      {},
    )
    expect(getBloodScore(nephew, uncle, state)).toBe(60)
  })

  it('returns 20 for no closer relation (same house)', () => {
    const person1 = makePerson({ id: createPersonId('pe', 0), childIds: [] })
    const person2 = makePerson({ id: createPersonId('pe', 1), childIds: [] })
    const state = makeState({ [person1.id]: person1, [person2.id]: person2 }, {})
    expect(getBloodScore(person1, person2, state)).toBe(20)
  })
})

describe('calcSuccessionScore', () => {
  it('applies birthStatus penalty for illegitimate', () => {
    const child = makePerson({
      id: createPersonId('pe', 1),
      birthStatus: 'illegitimate',
      childIds: [],
    })
    const deadHead = makePerson({ id: createPersonId('pe', 0), childIds: [child.id] })
    const state = makeState({ [deadHead.id]: deadHead, [child.id]: child }, {})
    const score = calcSuccessionScore(child, deadHead, state, testConfig)
    // blood=100, birthPenalty=20
    expect(score).toBe(100 + 50 * 1.0 + 5 * 2.0 + 5 * 1.0 + 0.5 * 10.0 - 20)
  })

  it('applies birthStatus penalty for unknown', () => {
    const child = makePerson({ id: createPersonId('pe', 1), birthStatus: 'unknown', childIds: [] })
    const deadHead = makePerson({ id: createPersonId('pe', 0), childIds: [child.id] })
    const state = makeState({ [deadHead.id]: deadHead, [child.id]: child }, {})
    const score = calcSuccessionScore(child, deadHead, state, testConfig)
    // blood=100, birthPenalty=10
    expect(score).toBe(100 + 50 * 1.0 + 5 * 2.0 + 5 * 1.0 + 0.5 * 10.0 - 10)
  })

  it('applies no penalty for legitimate', () => {
    const child = makePerson({
      id: createPersonId('pe', 1),
      birthStatus: 'legitimate',
      childIds: [],
    })
    const deadHead = makePerson({ id: createPersonId('pe', 0), childIds: [child.id] })
    const state = makeState({ [deadHead.id]: deadHead, [child.id]: child }, {})
    const score = calcSuccessionScore(child, deadHead, state, testConfig)
    // blood=100, birthPenalty=0
    expect(score).toBe(100 + 50 * 1.0 + 5 * 2.0 + 5 * 1.0 + 0.5 * 10.0 - 0)
  })
})

describe('chooseSuccessor', () => {
  it('returns the candidate with the highest score', () => {
    const person1 = makePerson({ id: createPersonId('pe', 0), legacyPrestige: 80 })
    const person2 = makePerson({ id: createPersonId('pe', 1), legacyPrestige: 90 })
    const candidates: SuccessionCandidate[] = [
      { person: person1, score: 100 },
      { person: person2, score: 120 },
    ]
    expect(chooseSuccessor(candidates)).toBe(candidates[1])
  })

  it('returns lexicographically smaller id on ties', () => {
    const personA = makePerson({ id: createPersonId('pe', 1) })
    const personB = makePerson({ id: createPersonId('pe', 0) })
    const candidates: SuccessionCandidate[] = [
      { person: personA, score: 100 },
      { person: personB, score: 100 },
    ]
    // personB has smaller id 'pe-0' < 'pe-1', so personB wins the tiebreak
    expect(chooseSuccessor(candidates)).toBe(candidates[1])
  })

  it('throws when no candidates', () => {
    expect(() => chooseSuccessor([])).toThrow('chooseSuccessor: no candidates')
  })
})
