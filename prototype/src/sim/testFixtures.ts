// v0.16 test fixture helpers.
//
// These helpers produce a WorldState that satisfies the integritySystem §25
// invariants (AnonymousHouse exists, every Province has a root LandContract + bailiff
// ProvinceOfficeAssignment, indexes are synchronized).
//
// Usage:
//   const state = makeEmptyV016State()
//   const s1 = addProvince(state, 'pr-1')          // creates Province only
//   const s2 = withPolity(s1, 'c-1', { ownerHouseId: 'h-1' })
//   const s3 = withHouse(s2, 'h-1', { seatProvinceId: 'pr-1' })
//   const s4 = bindProvinceToPolity(s3, 'pr-1', 'c-1')

import type { WorldState } from './types/world'
import type { Province } from './types/province'
import type { Polity } from './types/polity'
import type { House } from './types/house'
import type { Person } from './types/person'
import type { LandContract } from './types/landContract'
import type {
  ProvinceId,
  PolityId,
  HouseId,
  PersonId,
  LandContractId,
  ProvinceOfficeAssignmentId,
} from './types/ids'
import { ANONYMOUS_HOUSE_ID, ROOT_WORLD } from './types/landContract'
import { installPlaceholderBailiff } from './mutations/provinceOfficeMutations'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

export function makeEmptyV016State(): WorldState {
  const anon: House = {
    id: ANONYMOUS_HOUSE_ID,
    name: 'Anonymous',
    active: true,
    kind: 'system',
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-anon' as ProvinceId,
  }
  return {
    currentYear: 1000,
    currentMonth: 1,
    provinces: {},
    polities: {},
    houses: { [ANONYMOUS_HOUSE_ID]: anon },
    persons: {},
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    landContracts: {},
    provinceOfficeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
    provinceTerminalPolityCache: {},
    provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextProvinceOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
  }
}

export function withProvince(
  state: WorldState,
  id: ProvinceId,
  overrides: Partial<Province> = {},
): WorldState {
  const province: Province = {
    id,
    name: 'P',
    x: 0,
    y: 0,
    neighbors: [],
    habitability: 50,
    development: 1,
    polityControl: 100,
    popGroupIds: [],
    ...overrides,
  }
  return { ...state, provinces: { ...state.provinces, [id]: province } }
}

export function withPolity(
  state: WorldState,
  id: PolityId,
  overrides: Partial<Polity> & { ownerHouseId?: HouseId } = {},
): WorldState {
  const polity: Polity = {
    id,
    name: 'C',
    rank: 2,
    treasury: 0,
    adminPower: 0,
    legacyPrestige: 0,
    active: true,
    capitalProvinceId: 'pr-0' as ProvinceId,
    ...overrides,
  }
  const nextPolities = { ...state.polities, [id]: polity }
  const nextByOwnerHouse = { ...state.polityIndex.byOwnerHouse }
  if (polity.ownerHouseId !== undefined) {
    const slot = nextByOwnerHouse[polity.ownerHouseId] ?? []
    if (!slot.includes(id)) {
      nextByOwnerHouse[polity.ownerHouseId] = [...slot, id]
    }
  }
  return {
    ...state,
    polities: nextPolities,
    polityIndex: { byOwnerHouse: nextByOwnerHouse },
  }
}

export function withHouse(
  state: WorldState,
  id: HouseId,
  overrides: Partial<House> = {},
): WorldState {
  const house: House = {
    id,
    name: 'H',
    active: true,
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-0' as ProvinceId,
    ...overrides,
  }
  return { ...state, houses: { ...state.houses, [id]: house } }
}

export function withPerson(
  state: WorldState,
  id: PersonId,
  overrides: Partial<Person> & { houseId: HouseId },
): WorldState {
  const person: Person = {
    id,
    name: 'P',
    sex: 'male',
    age: 30,
    alive: true,
    childIds: [],
    birthStatus: 'legitimate',
    abilities: { ...DEFAULT_ABILITIES },
    aptitudes: { ...DEFAULT_ABILITIES },
    traits: { ambition: 0.5, caution: 0.5 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
    ...overrides,
  }
  const house = state.houses[person.houseId]
  const houses = house
    ? {
        ...state.houses,
        [person.houseId]: house.memberIds.includes(id)
          ? house
          : { ...house, memberIds: [...house.memberIds, id] },
      }
    : state.houses
  return { ...state, persons: { ...state.persons, [id]: person }, houses }
}

// Create a root LandContract (world → polity) for a Province, plus a placeholder bailiff.
// If the Province already has a chain, this is a no-op.
export function bindProvinceToPolity(
  state: WorldState,
  provinceId: ProvinceId,
  polityId: PolityId,
): WorldState {
  if (!state.provinces[provinceId]) {
    throw new Error(`bindProvinceToPolity: Province ${provinceId} not found`)
  }
  if (!state.polities[polityId]) {
    throw new Error(`bindProvinceToPolity: Polity ${polityId} not found`)
  }
  const existing = state.landContractIndex.byProvince[provinceId] ?? []
  if (existing.length > 0) {
    throw new Error(`bindProvinceToPolity: Province ${provinceId} already has a LandContract chain`)
  }
  const contractId = ('lc-' + state.nextLandContractId) as LandContractId
  const contract: LandContract = {
    id: contractId,
    provinceId,
    rootAuthorityId: ROOT_WORLD,
    granteePolityId: polityId,
    terms: { taxRateToGrantor: 0 },
  }
  const granteeSlot = state.landContractIndex.byGranteePolity[polityId] ?? []
  let nextState: WorldState = {
    ...state,
    landContracts: { ...state.landContracts, [contractId]: contract },
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [provinceId]: [contractId] },
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [polityId]: [...granteeSlot, contractId],
      },
      byParent: { ...state.landContractIndex.byParent },
    },
    provinceTerminalPolityCache: {
      ...state.provinceTerminalPolityCache,
      [provinceId]: polityId,
    },
    nextLandContractId: state.nextLandContractId + 1,
  }
  // Install placeholder bailiff so integrity §25 #23/#24/#33 pass.
  nextState = installPlaceholderBailiff(nextState, {
    provinceId,
    appointingPolityId: polityId,
    year: nextState.currentYear,
    month: nextState.currentMonth,
  })
  return nextState
}

// Wire a Province through a Polity whose ownerHouseId is set.
// Convenience for tests that need a Province "owned by" a House via its Polity.
export function bindProvinceToHouseViaPolity(
  state: WorldState,
  provinceId: ProvinceId,
  polityId: PolityId,
  houseId: HouseId,
): WorldState {
  const polity = state.polities[polityId]
  if (!polity) {
    throw new Error(`bindProvinceToHouseViaPolity: Polity ${polityId} not found`)
  }
  const updatedPolity: Polity = {
    ...polity,
    ownerHouseId: houseId,
  }
  const previousOwner = state.polities[polityId]?.ownerHouseId
  const nextByOwnerHouse = { ...state.polityIndex.byOwnerHouse }
  if (previousOwner !== undefined && previousOwner !== houseId) {
    nextByOwnerHouse[previousOwner] = (nextByOwnerHouse[previousOwner] ?? []).filter(
      (p) => p !== polityId,
    )
  }
  const slot = nextByOwnerHouse[houseId] ?? []
  if (!slot.includes(polityId)) {
    nextByOwnerHouse[houseId] = [...slot, polityId]
  }
  let nextState: WorldState = {
    ...state,
    polities: { ...state.polities, [polityId]: updatedPolity },
    polityIndex: { byOwnerHouse: nextByOwnerHouse },
  }
  nextState = bindProvinceToPolity(nextState, provinceId, polityId)
  return nextState
}

// Convenience: void unused-vars compiler complaint for ProvinceOfficeAssignmentId
// (kept as documented type alias for callers that want strong typing).
export type _ProvinceOfficeAssignmentIdAlias = ProvinceOfficeAssignmentId
