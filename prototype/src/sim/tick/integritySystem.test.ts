import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { House } from '../types/house'
import type { Polity } from '../types/polity'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runIntegritySystem } from './integritySystem'
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
      name: 'DeadPerson',
      sex: 'male',
      age: 50,
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
      name: 'H0',
      active: true,
      memberIds: [personId],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      name: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
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
      currentMonth: 1,
      provinces: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [personId]: person },
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
      name: 'DeadLeader',
      sex: 'male',
      age: 50,
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
      name: 'AliveMember',
      sex: 'female',
      age: 30,
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
      name: 'H0',
      active: true,
      memberIds: [deadLeaderId, 'pe-alive' as PersonId],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      name: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
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
      currentMonth: 1,
      provinces: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [deadLeaderId]: deadLeader, ['pe-alive' as PersonId]: aliveMember },
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
      name: 'DeadHolder',
      sex: 'male',
      age: 40,
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
      name: 'H0',
      active: true,
      memberIds: [deadHolderId],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      name: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
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
      currentMonth: 1,
      provinces: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [deadHolderId]: deadHolder },
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
      name: 'AliveHolder',
      sex: 'male',
      age: 30,
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
      name: 'H0',
      active: true,
      memberIds: [aliveHolderId],
      cadetHouseIds: [],
      legacyPrestige: 50,
      wealth: 100,
      seatProvinceId: '' as ProvinceId,
    }

    const polity: Polity = {
      id: polityId,
      name: 'C0',
      rank: 2,
      ownerHouseId: houseId,
      treasury: 100,
      legacyPrestige: 50,
      adminPower: 50,
      active: true,
      capitalProvinceId: '' as ProvinceId,
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
      currentMonth: 1,
      provinces: {},
      polities: { [polityId]: polity },
      houses: { [houseId]: house },
      persons: { [aliveHolderId]: aliveHolder },
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments,
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 1,
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
    }

    const ctx = makeCtx(world)

    expect(() => runIntegritySystem(ctx)).toThrow('negative unpaidCount')
  })
})

function makeValidWorldState(): WorldState {
  const { world } = generateWorld('integrity-valid')
  return world
}
