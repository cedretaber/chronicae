import { describe, it, expect } from 'vitest'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { ProvinceId, HouseId, PolityId, PersonId, OfficeAssignmentId } from '../types/ids'
import type { Person, AbilityScores } from '../types/person'
import type { OfficeAssignment, OrganizationRef } from '../types/office'
import { runControlSystem } from './controlSystem'
import { runLandRevenueSystem } from './landRevenueSystem'
import { calcGeneralDeclareThreshold } from '../selectors/personAbilityEffects'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeAbilities(overrides: Partial<AbilityScores> = {}): AbilityScores {
  return { ...DEFAULT_ABILITIES, ...overrides }
}

function makePerson(ambition: number, caution: number): Person {
  return {
    id: 'pe-0' as PersonId,
    nameKey: 'TestPerson',
    sex: 'male',
    age: 30,
    lifeStage: 'young_adulthood',
    alive: true,
    houseId: 'h-0' as HouseId,
    childIds: [],
    birthStatus: 'unknown',
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition, caution },
    legacyPrestige: 50,
    wealth: 0,
    attitudes: {},
  }
}

function makeOfficeAssignment(
  id: OfficeAssignmentId,
  organization: OrganizationRef,
  role: string,
  holderPersonId: PersonId,
): OfficeAssignment {
  return {
    id,
    organization,
    role: role as OfficeAssignment['role'],
    holderPersonId,
    active: true,
    startYear: 1444,
    unpaidCount: 0,
  }
}

function makeWorldState(
  personOverrides: Partial<Person> = {},
  officeAssignments: Record<string, PersonId> = {},
  treasury: number = 100,
  houseWealth: number = 100,
): WorldState {
  const person = { ...makePerson(0.5, 0.5), ...personOverrides }
  const provinceId = 'p-0' as ProvinceId
  const houseId = 'h-0' as HouseId
  const polityId = 'dp-0' as PolityId

  const officeAssignmentsMap: Record<OfficeAssignmentId, OfficeAssignment> = {}
  const officeIndexByOrg: Record<string, OfficeAssignmentId[]> = {}

  let assignmentCounter = 0

  // Set up polity 'leader' office assignment (required by getPolityRulerHouse)
  const polityLeaderId = ('of-' + assignmentCounter) as OfficeAssignmentId
  assignmentCounter++
  const polityLeaderOffice = makeOfficeAssignment(
    polityLeaderId,
    { kind: 'polity', id: polityId },
    'leader',
    person.id,
  )
  officeAssignmentsMap[polityLeaderId] = polityLeaderOffice
  const polityKey = `polity:${polityId}`
  if (!officeIndexByOrg[polityKey]) officeIndexByOrg[polityKey] = []
  officeIndexByOrg[polityKey].push(polityLeaderId)

  // Set up house 'leader' office assignment (required by getHouseLeader)
  const houseLeaderId = ('of-' + assignmentCounter) as OfficeAssignmentId
  assignmentCounter++
  const houseLeaderOffice = makeOfficeAssignment(
    houseLeaderId,
    { kind: 'house', id: houseId },
    'leader',
    person.id,
  )
  officeAssignmentsMap[houseLeaderId] = houseLeaderOffice
  const houseKey = `house:${houseId}`
  if (!officeIndexByOrg[houseKey]) officeIndexByOrg[houseKey] = []
  officeIndexByOrg[houseKey].push(houseLeaderId)

  // Set up additional office assignments
  for (const [role, holderId] of Object.entries(officeAssignments)) {
    const officeId = ('of-' + assignmentCounter) as OfficeAssignmentId
    assignmentCounter++
    const office = makeOfficeAssignment(officeId, { kind: 'polity', id: polityId }, role, holderId)
    officeAssignmentsMap[officeId] = office
    if (!officeIndexByOrg[polityKey]) officeIndexByOrg[polityKey] = []
    officeIndexByOrg[polityKey].push(officeId)
  }

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 1444, absoluteWeek: 69312, currentWeekOfYear: 1 }
  state = withProvince(state, provinceId, { nameKey: 'P0' })
  // Set Holding polityControl to 50 for runControlSystem tests
  const p0HoldingId = state.provinces[provinceId]!.holdingIds[0]!
  state = {
    ...state,
    holdings: {
      ...state.holdings,
      [p0HoldingId]: { ...state.holdings[p0HoldingId]!, polityControl: 50 },
    },
  }
  state = withHouse(state, houseId, {
    nameKey: 'H0',
    memberIds: [person.id],
    deceasedMemberIds: [],
    legacyPrestige: 50,
    wealth: houseWealth,
    seatProvinceId: provinceId,
  })
  state = withPolity(state, polityId, {
    ownerHouseId: houseId,
    treasury,
    legacyPrestige: 50,
    adminPower: 10,
    capitalProvinceId: provinceId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  // Add person and merge offices on top of fixture-provided defaults.
  state = {
    ...state,
    persons: { ...state.persons, [person.id]: person },
    officeAssignments: { ...state.officeAssignments, ...officeAssignmentsMap },
    officeIndex: {
      byOrganization: { ...state.officeIndex.byOrganization, ...officeIndexByOrg },
      byHolderPerson: { ...state.officeIndex.byHolderPerson },
    },
    nextOfficeAssignmentId: state.nextOfficeAssignmentId + assignmentCounter,
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
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
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    clans: {},
    nextClanId: 1,
  }
  return state
}

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('test'),
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

describe('runControlSystem — polityControl growth', () => {
  it('admin=10 chancellor grows polityControl faster than admin=5', () => {
    const highAdminPerson = makePerson(0.5, 0.5)
    const highAdminState = makeWorldState(
      { abilities: makeAbilities({ numeracy: 100 }), aptitudes: makeAbilities({ numeracy: 100 }) },
      { administrator: highAdminPerson.id },
    )
    const highAdminCtx = makeCtx(highAdminState)
    const highAdminResult = runControlSystem(highAdminCtx)

    const neutralPerson = makePerson(0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { administrator: neutralPerson.id })
    const neutralCtx = makeCtx(neutralState)
    const neutralResult = runControlSystem(neutralCtx)

    const highAdminProv = highAdminResult.state.provinces['p-0' as ProvinceId]!
    const highAdminHolding = highAdminProv.holdingIds[0]!
    const neutralProv = neutralResult.state.provinces['p-0' as ProvinceId]!
    const neutralHolding = neutralProv.holdingIds[0]!

    expect(highAdminResult.state.holdings[highAdminHolding]!.polityControl).toBeGreaterThan(
      neutralResult.state.holdings[neutralHolding]!.polityControl,
    )
  })

  it('admin=5 chancellor grows polityControl faster than admin=0', () => {
    const neutralPerson = makePerson(0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { administrator: neutralPerson.id })
    const neutralCtx = makeCtx(neutralState)
    const neutralResult = runControlSystem(neutralCtx)

    const lowAdminPerson = makePerson(0.5, 0.5)
    const lowAdminState = makeWorldState(
      { abilities: makeAbilities({ numeracy: 0 }), aptitudes: makeAbilities({ numeracy: 0 }) },
      { administrator: lowAdminPerson.id },
    )
    const lowAdminCtx = makeCtx(lowAdminState)
    const lowAdminResult = runControlSystem(lowAdminCtx)

    const neutralProv = neutralResult.state.provinces['p-0' as ProvinceId]!
    const neutralHolding = neutralProv.holdingIds[0]!
    const lowAdminProv = lowAdminResult.state.provinces['p-0' as ProvinceId]!
    const lowAdminHolding = lowAdminProv.holdingIds[0]!

    expect(neutralResult.state.holdings[neutralHolding]!.polityControl).toBeGreaterThan(
      lowAdminResult.state.holdings[lowAdminHolding]!.polityControl,
    )
  })

  it('expected values: governance=100 → 52.5, governance=50 → 52.0, governance=0 → 51.5', () => {
    const govMax = makeAbilities({ numeracy: 100, learning: 100, charisma: 100, insight: 100 })
    const admin10State = makeWorldState(
      { abilities: govMax, aptitudes: govMax },
      { administrator: 'pe-0' as PersonId },
    )
    const admin10Result = runControlSystem(makeCtx(admin10State))
    const admin10Prov = admin10Result.state.provinces['p-0' as ProvinceId]!
    const admin10Holding = admin10Prov.holdingIds[0]!
    expect(admin10Result.state.holdings[admin10Holding]!.polityControl).toBeCloseTo(52.5, 5)

    const admin5State = makeWorldState({}, { administrator: 'pe-0' as PersonId })
    const admin5Result = runControlSystem(makeCtx(admin5State))
    const admin5Prov = admin5Result.state.provinces['p-0' as ProvinceId]!
    const admin5Holding = admin5Prov.holdingIds[0]!
    expect(admin5Result.state.holdings[admin5Holding]!.polityControl).toBeCloseTo(52.0, 5)

    const govMin = makeAbilities({ numeracy: 0, learning: 0, charisma: 0, insight: 0 })
    const admin0State = makeWorldState(
      { abilities: govMin, aptitudes: govMin },
      { administrator: 'pe-0' as PersonId },
    )
    const admin0Result = runControlSystem(makeCtx(admin0State))
    const admin0Prov = admin0Result.state.provinces['p-0' as ProvinceId]!
    const admin0Holding = admin0Prov.holdingIds[0]!
    expect(admin0Result.state.holdings[admin0Holding]!.polityControl).toBeCloseTo(51.5, 5)
  })
})

describe('runControlSystem — capital province maxControl', () => {
  it('capital province at 100 stays at 100 regardless of chancellor admin', () => {
    const admin0Person = makePerson(0.5, 0.5)
    const provinceId = 'p-0' as ProvinceId
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const holdingId = 'hl-0' as import('../types/ids').HoldingId

    const officeId = 'of-0' as OfficeAssignmentId
    const office: OfficeAssignment = {
      id: officeId,
      organization: { kind: 'polity', id: polityId },
      role: 'administrator',
      holderPersonId: admin0Person.id,
      active: true,
      startYear: 1444,
      unpaidCount: 0,
    }

    const world: WorldState = {
      currentYear: 1444,
      absoluteWeek: 69312,
      currentWeekOfYear: 1,
      provinces: {
        [provinceId]: {
          id: provinceId,
          stateId: 'sr-0' as import('../types/ids').StateRegionId,
          nameKey: 'Capital',
          x: 0,
          y: 0,
          neighbors: [],
          terrain: 'plains',
          features: [],
          holdingIds: [holdingId],
        },
      },
      holdings: {
        [holdingId]: {
          id: holdingId,
          provinceId,
          nameKey: 'h',
          kind: 'manor' as const,
          polityControl: 100,
          landQuality: 50,
          weight: 1,
        },
      },
      states: {},
      polities: {
        [polityId]: {
          id: polityId,
          nameSource: { kind: 'pool', nameKey: 'C0' },
          rank: 2,
          ownerHouseId: houseId,
          treasury: 100,
          legacyPrestige: 50,
          adminPower: 10,
          active: true,
          capitalProvinceId: provinceId,
          origin: { kind: 'worldgen' },
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          nameKey: 'H0',
          active: true,
          memberIds: [],
          deceasedMemberIds: [],
          cadetHouseIds: [],
          legacyPrestige: 50,
          wealth: 100,
          seatProvinceId: provinceId,
        },
      },
      persons: {
        [admin0Person.id]: admin0Person,
      },
      livingPersonIds: [admin0Person.id],
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      politicalRights: {},
      politicalRightIndex: { byPolity: {}, byHolder: {}, byTarget: {} },
      nextPoliticalRightId: 0,
      officeAssignments: { [officeId]: office },
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: { [`polity:${polityId}`]: [officeId] }, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
      landContracts: {},
      holdingOfficeAssignments: {},
      holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
      landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
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
      personTrainingExperience: {},
      waitingAimIds: [],
      nextTaskId: 0,
      nextPersonActivityLogId: 0,
      popIndex: { byHolding: {} },
      nextPopGroupId: 0,
      clans: {},
      nextClanId: 1,
    }

    const result = runControlSystem(makeCtx(world))
    expect(result.state.holdings[holdingId]!.polityControl).toBe(100)
  })
})

// TODO Phase 3: re-enable when EconomySystem is updated to POP-based production
describe.skip('runLandRevenueSystem — treasurer tax efficiency', () => {
  it('treasurer admin=10 produces higher treasury than admin=5', () => {
    const highAdminPerson = makePerson(0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runLandRevenueSystem(makeCtx(highAdminState))
    const highAdminTreasury = highAdminResult.state.polities['dp-0' as PolityId]!.treasury

    const neutralPerson = makePerson(0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runLandRevenueSystem(makeCtx(neutralState))
    const neutralTreasury = neutralResult.state.polities['dp-0' as PolityId]!.treasury

    expect(highAdminTreasury).toBeGreaterThan(neutralTreasury)
  })

  it('expected treasury values: admin=10 → 103.0, admin=5 → 102.5', () => {
    const highAdminPerson = makePerson(0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runLandRevenueSystem(makeCtx(highAdminState))
    const highAdminTreasury = highAdminResult.state.polities['dp-0' as PolityId]!.treasury
    expect(highAdminTreasury).toBeCloseTo(103.0, 5)

    const neutralPerson = makePerson(0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runLandRevenueSystem(makeCtx(neutralState))
    const neutralTreasury = neutralResult.state.polities['dp-0' as PolityId]!.treasury
    expect(neutralTreasury).toBeCloseTo(102.5, 5)
  })
})

// TODO Phase 3: re-enable when EconomySystem is updated to POP-based production
describe.skip('runLandRevenueSystem — houseIncome unaffected by treasurer', () => {
  it('house.wealth is the same regardless of treasurer admin level', () => {
    const highAdminPerson = makePerson(0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runLandRevenueSystem(makeCtx(highAdminState))
    const highAdminWealth = highAdminResult.state.houses['h-0' as HouseId]!.wealth

    const neutralPerson = makePerson(0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runLandRevenueSystem(makeCtx(neutralState))
    const neutralWealth = neutralResult.state.houses['h-0' as HouseId]!.wealth

    expect(highAdminWealth).toBe(neutralWealth)
  })

  it('expected house.wealth: 102.5 for both admin=10 and admin=5', () => {
    const highAdminPerson = makePerson(0.5, 1.0)
    const highAdminState = makeWorldState(highAdminPerson, { treasurer: highAdminPerson.id })
    const highAdminResult = runLandRevenueSystem(makeCtx(highAdminState))
    const highAdminWealth = highAdminResult.state.houses['h-0' as HouseId]!.wealth
    expect(highAdminWealth).toBeCloseTo(102.5, 5)

    const neutralPerson = makePerson(0.5, 0.5)
    const neutralState = makeWorldState(neutralPerson, { treasurer: neutralPerson.id })
    const neutralResult = runLandRevenueSystem(makeCtx(neutralState))
    const neutralWealth = neutralResult.state.houses['h-0' as HouseId]!.wealth
    expect(neutralWealth).toBeCloseTo(102.5, 5)
  })
})

describe('calcGeneralDeclareThreshold — integration with defaultConfig', () => {
  it('ambition=1.0 general returns threshold below base 0.45', () => {
    const ambitionPerson = makePerson(1.0, 0.5)
    const state = makeWorldState(ambitionPerson, { military: ambitionPerson.id })
    const threshold = calcGeneralDeclareThreshold(state, 'dp-0' as PolityId, defaultConfig)
    expect(threshold).toBe(0.4)
    expect(threshold).toBeLessThan(0.45)
  })

  it('caution=1.0 general returns threshold above base 0.45', () => {
    const cautionPerson = makePerson(0.5, 1.0)
    const state = makeWorldState(cautionPerson, { military: cautionPerson.id })
    const threshold = calcGeneralDeclareThreshold(state, 'dp-0' as PolityId, defaultConfig)
    expect(threshold).toBe(0.5)
    expect(threshold).toBeGreaterThan(0.45)
  })

  it('disabled effects returns base threshold 0.45', () => {
    const ambitionPerson = makePerson(1.0, 0.5)
    const state = makeWorldState(ambitionPerson, { military: ambitionPerson.id })
    const disabledConfig = { ...defaultConfig, personAbilityEffectsEnabled: false }
    const threshold = calcGeneralDeclareThreshold(state, 'dp-0' as PolityId, disabledConfig)
    expect(threshold).toBe(0.45)
  })
})
