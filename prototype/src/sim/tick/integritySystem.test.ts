import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type {
  PersonId,
  HouseId,
  PolityId,
  ProvinceId,
  ChronicleEntryId,
  EventId,
} from '../types/ids'
import type { Person } from '../types/person'
import type { ChronicleEntry } from '../types/chronicle'
import type { House } from '../types/house'
import type { Polity } from '../types/polity'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runIntegritySystem, collectIntegrityErrors } from './integritySystem'
import { generateWorld } from '../worldgen/generateWorld'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeCtx(world: WorldState): TickContext {
  return {
    state: world,
    rng: createRng('integrity-test'),
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

describe('runIntegritySystem', () => {
  it('valid world passes integrity check without throwing', () => {
    const world = makeValidWorldState()
    const ctx = makeCtx(world)

    expect(() => runIntegritySystem(ctx)).not.toThrow()
  })

  it('throws when dead person holds an office', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const personId = 'pe-0' as PersonId

    const person: Person = {
      id: personId,
      nameKey: 'DeadPerson',
      sex: 'male',
      age: 50,
      lifeStage: 'mature_adulthood',
      alive: false,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
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
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      nameKey: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
      origin: { kind: 'worldgen' },
    }

    const officeAssignmentId = 'oa-0' as import('../types/ids').OfficeAssignmentId
    const officeAssignments: Record<string, import('../types/office').OfficeAssignment> = {
      [officeAssignmentId]: {
        id: officeAssignmentId,
        organization: { kind: 'polity', id: polityId },
        role: 'administrator',
        holderPersonId: personId,
        active: true,
        startYear: 1,
        unpaidCount: 0,
      },
    }

    const world: WorldState = {
      currentYear: 1,
      currentWeekOfYear: 1,
      absoluteWeek: 48,
      provinces: {},
      holdings: {},
      states: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [personId]: person },
      livingPersonIds: [],
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
      clans: {},
      nextClanId: 1,
      popIndex: { byHolding: {} },
      nextPopGroupId: 0,
    }

    const ctx = makeCtx(world)

    expect(() => runIntegritySystem(ctx)).toThrow('not alive')
  })

  it('throws when active house leader is not alive', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const deadLeaderId = 'pe-dead' as PersonId

    const deadLeader: Person = {
      id: deadLeaderId,
      nameKey: 'DeadLeader',
      sex: 'male',
      age: 50,
      lifeStage: 'mature_adulthood',
      alive: false,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 30,
      wealth: 0,
      attitudes: {},
    }

    const aliveMember: Person = {
      id: 'pe-alive' as PersonId,
      nameKey: 'AliveMember',
      sex: 'female',
      age: 30,
      lifeStage: 'young_adulthood',
      alive: true,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 20,
      wealth: 0,
      attitudes: {},
    }

    const house: House = {
      id: houseId,
      nameKey: 'H0',
      active: true,
      memberIds: [deadLeaderId, 'pe-alive' as PersonId],
      deceasedMemberIds: [],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      nameKey: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
      origin: { kind: 'worldgen' },
    }

    const officeAssignmentId = 'oa-0' as import('../types/ids').OfficeAssignmentId
    const officeAssignments: Record<string, import('../types/office').OfficeAssignment> = {
      [officeAssignmentId]: {
        id: officeAssignmentId,
        organization: { kind: 'house', id: houseId },
        role: 'leader',
        holderPersonId: deadLeaderId,
        active: true,
        startYear: 1,
        unpaidCount: 0,
      },
    }

    const world: WorldState = {
      currentYear: 1,
      currentWeekOfYear: 1,
      absoluteWeek: 48,
      provinces: {},
      holdings: {},
      states: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [deadLeaderId]: deadLeader, ['pe-alive' as PersonId]: aliveMember },
      livingPersonIds: ['pe-alive' as PersonId],
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
      clans: {},
      nextClanId: 1,
      popIndex: { byHolding: {} },
      nextPopGroupId: 0,
    }

    const ctx = makeCtx(world)

    expect(() => runIntegritySystem(ctx)).toThrow('not alive')
  })

  it('throws when active OfficeAssignment holder is dead', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const deadHolderId = 'pe-dead' as PersonId

    const deadHolder: Person = {
      id: deadHolderId,
      nameKey: 'DeadHolder',
      sex: 'male',
      age: 40,
      lifeStage: 'mature_adulthood',
      alive: false,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 30,
      wealth: 0,
      attitudes: {},
    }

    const house: House = {
      id: houseId,
      nameKey: 'H0',
      active: true,
      memberIds: [deadHolderId],
      deceasedMemberIds: [],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      nameKey: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
      origin: { kind: 'worldgen' },
    }

    const officeAssignmentId = 'oa-0' as import('../types/ids').OfficeAssignmentId
    const officeAssignments: Record<string, import('../types/office').OfficeAssignment> = {
      [officeAssignmentId]: {
        id: officeAssignmentId,
        organization: { kind: 'polity', id: polityId },
        role: 'treasurer',
        holderPersonId: deadHolderId,
        active: true,
        startYear: 1,
        unpaidCount: 0,
      },
    }

    const world: WorldState = {
      currentYear: 1,
      currentWeekOfYear: 1,
      absoluteWeek: 48,
      provinces: {},
      holdings: {},
      states: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [deadHolderId]: deadHolder },
      livingPersonIds: [],
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
      clans: {},
      nextClanId: 1,
      popIndex: { byHolding: {} },
      nextPopGroupId: 0,
    }

    const ctx = makeCtx(world)

    expect(() => runIntegritySystem(ctx)).toThrow('not alive')
  })

  it('throws when OfficeAssignment has negative unpaidCount', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const aliveHolderId = 'pe-alive' as PersonId

    const aliveHolder: Person = {
      id: aliveHolderId,
      nameKey: 'AliveHolder',
      sex: 'male',
      age: 30,
      lifeStage: 'young_adulthood',
      alive: true,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 30,
      wealth: 0,
      attitudes: {},
    }

    const house: House = {
      id: houseId,
      nameKey: 'H0',
      active: true,
      memberIds: [aliveHolderId],
      deceasedMemberIds: [],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      nameKey: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
      origin: { kind: 'worldgen' },
    }

    const officeAssignmentId = 'oa-0' as import('../types/ids').OfficeAssignmentId
    const officeAssignments: Record<string, import('../types/office').OfficeAssignment> = {
      [officeAssignmentId]: {
        id: officeAssignmentId,
        organization: { kind: 'polity', id: polityId },
        role: 'advisor',
        holderPersonId: aliveHolderId,
        active: true,
        startYear: 1,
        unpaidCount: -1,
      },
    }

    const world: WorldState = {
      currentYear: 1,
      currentWeekOfYear: 1,
      absoluteWeek: 48,
      provinces: {},
      holdings: {},
      states: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [aliveHolderId]: aliveHolder },
      livingPersonIds: [aliveHolderId],
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
      clans: {},
      nextClanId: 1,
      popIndex: { byHolding: {} },
      nextPopGroupId: 0,
    }

    const ctx = makeCtx(world)

    expect(() => runIntegritySystem(ctx)).toThrow('negative unpaidCount')
  })

  it('throws when non-leader active OfficeAssignment has startYear > currentYear (§21.2 O4)', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const aliveHolderId = 'pe-alive' as PersonId

    const aliveHolder: Person = {
      id: aliveHolderId,
      nameKey: 'AliveHolder',
      sex: 'male',
      age: 30,
      lifeStage: 'young_adulthood',
      alive: true,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 30,
      wealth: 0,
      attitudes: {},
    }

    const house: House = {
      id: houseId,
      nameKey: 'H0',
      active: true,
      memberIds: [aliveHolderId],
      deceasedMemberIds: [],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      nameKey: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
      origin: { kind: 'worldgen' },
    }

    const officeAssignmentId = 'oa-0' as import('../types/ids').OfficeAssignmentId
    const officeAssignments: Record<string, import('../types/office').OfficeAssignment> = {
      [officeAssignmentId]: {
        id: officeAssignmentId,
        organization: { kind: 'polity', id: polityId },
        role: 'administrator',
        holderPersonId: aliveHolderId,
        active: true,
        startYear: 100,
        unpaidCount: 0,
      },
    }

    const world: WorldState = {
      currentYear: 50,
      currentWeekOfYear: 1,
      absoluteWeek: 50 * 48,
      provinces: {},
      holdings: {},
      states: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [aliveHolderId]: aliveHolder },
      livingPersonIds: [aliveHolderId],
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
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
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
      // v0.23 Task/ActivityLog
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

    const errors = collectIntegrityErrors(world)
    const o4Error = errors.find((e) => e.message.includes('§21.2 O4'))
    expect(o4Error).toBeDefined()
  })

  it('throws when alive Person has deathCircumstance set (§21.3 D2)', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const alivePersonId = 'pe-alive' as PersonId

    const alivePerson: Person = {
      id: alivePersonId,
      nameKey: 'AlivePerson',
      sex: 'male',
      age: 30,
      lifeStage: 'young_adulthood',
      alive: true,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 30,
      wealth: 0,
      attitudes: {},
      deathCircumstance: 'natural',
    }

    const house: House = {
      id: houseId,
      nameKey: 'H0',
      active: true,
      memberIds: [alivePersonId],
      deceasedMemberIds: [],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      nameKey: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
      origin: { kind: 'worldgen' },
    }

    const world: WorldState = {
      currentYear: 1,
      currentWeekOfYear: 1,
      absoluteWeek: 48,
      provinces: {},
      holdings: {},
      states: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [alivePersonId]: alivePerson },
      livingPersonIds: [alivePersonId],
      activePlots: {},
      popGroups: {},
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
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 0,
      // v0.23 Task/ActivityLog
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

    const errors = collectIntegrityErrors(world)
    const d2Error = errors.find((e) => e.message.includes('§21.3 D2'))
    expect(d2Error).toBeDefined()
  })

  it('throws when placeholder Person has deathCircumstance=faded_from_history (§21.3 D3)', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const placeholderPersonId = 'pe-placeholder' as PersonId

    const placeholderPerson: Person = {
      id: placeholderPersonId,
      nameKey: 'Placeholder',
      sex: 'male',
      age: 25,
      lifeStage: 'young_adulthood',
      alive: true,
      houseId,
      childIds: [],
      birthStatus: 'unknown',
      abilities: DEFAULT_ABILITIES,
      aptitudes: DEFAULT_ABILITIES,
      traits: { ambition: 0.5, caution: 0.5 },
      legacyPrestige: 10,
      wealth: 0,
      attitudes: {},
      kind: 'placeholder',
      deathCircumstance: 'faded_from_history',
    }

    const house: House = {
      id: houseId,
      nameKey: 'H0',
      active: true,
      memberIds: [placeholderPersonId],
      deceasedMemberIds: [],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      nameKey: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
      origin: { kind: 'worldgen' },
    }

    const world: WorldState = {
      currentYear: 1,
      currentWeekOfYear: 1,
      absoluteWeek: 48,
      provinces: {},
      holdings: {},
      states: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [placeholderPersonId]: placeholderPerson },
      livingPersonIds: [placeholderPersonId],
      activePlots: {},
      popGroups: {},
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
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 0,
      // v0.23 Task/ActivityLog
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

    const errors = collectIntegrityErrors(world)
    const d3Error = errors.find((e) => e.message.includes('§21.3 D3'))
    expect(d3Error).toBeDefined()
  })
})

function makeValidWorldState(): WorldState {
  const { world } = generateWorld('integrity-valid')
  return world
}

// v0.38 §7.1: chronicle index ↔ entry の内部整合検査が「違反を検出できる」ことを確認する。
//   300年×4seed clean は false-positive が無いことの証明にすぎず、catch 能力は別途検証が要る。
describe('chronicle index ↔ entry integrity (v0.38 §7.1)', () => {
  const PERSON_REF_ID = 'pe-chronicle-test'

  // soft-ref なので参照先 person が world.persons に存在しなくてよい (合成 id で良い)。
  function makeEntry(id: string): ChronicleEntry {
    return {
      id: id as ChronicleEntryId,
      year: 10,
      weekOfYear: 5,
      category: 'life',
      importance: 'major',
      sourceEventId: 'e-test-0' as EventId,
      sourceEventType: 'IMPORTANT_PERSON_DIED',
      templateKey: 'person.died',
      params: {},
      entityRefs: [{ kind: 'person', id: PERSON_REF_ID }],
    }
  }

  it('valid entry + matching index produces no chronicle violation', () => {
    const world = makeValidWorldState()
    const entry = makeEntry('ch-0')
    world.chronicleEntries[entry.id] = entry
    world.chronicleIndex.byPerson[PERSON_REF_ID] = [entry.id]
    const errors = collectIntegrityErrors(world, { debug: false, config: defaultConfig })
    expect(errors.some((e) => e.message.includes('§7.1'))).toBe(false)
  })

  it('fires when an index bucket references a missing ChronicleEntry (forward)', () => {
    const world = makeValidWorldState()
    world.chronicleIndex.byPerson[PERSON_REF_ID] = ['ch-missing' as ChronicleEntryId]
    const errors = collectIntegrityErrors(world, { debug: false, config: defaultConfig })
    expect(errors.some((e) => e.message.includes('references missing ChronicleEntry'))).toBe(true)
  })

  it('fires when an entry ref is not registered in the matching index (reverse)', () => {
    const world = makeValidWorldState()
    const entry = makeEntry('ch-0')
    world.chronicleEntries[entry.id] = entry
    // byPerson に登録しない → reverse 検査が拾うべき
    const errors = collectIntegrityErrors(world, { debug: false, config: defaultConfig })
    expect(errors.some((e) => e.message.includes('not registered in chronicleIndex'))).toBe(true)
  })
})
