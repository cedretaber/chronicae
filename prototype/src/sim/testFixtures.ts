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
import type { StateRegion } from './types/stateRegion'
import type { Polity } from './types/polity'
import type { House } from './types/house'
import type { Person } from './types/person'
import type { LandContract, Holding, HoldingOfficeAssignment } from './types/landContract'
import type {
  ProvinceId,
  PolityId,
  HouseId,
  PersonId,
  LandContractId,
  HoldingOfficeAssignmentId,
  HoldingId,
  StateRegionId,
} from './types/ids'
import { createHoldingId } from './types/ids'
import { ANONYMOUS_HOUSE_ID, PLACEHOLDER_PERSON_ID, ROOT_WORLD } from './types/landContract'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

export function makeEmptyV016State(): WorldState {
  // v0.17.2: singleton placeholder Person を含む状態で初期化する。
  // worldgen と整合 (PLACEHOLDER_PERSON_ID は AnonymousHouse.memberIds に常駐)。
  const placeholderSingleton: Person = {
    id: PLACEHOLDER_PERSON_ID,
    name: 'Anonymous',
    sex: 'male',
    age: 30,
    alive: true,
    kind: 'placeholder',
    houseId: ANONYMOUS_HOUSE_ID,
    childIds: [],
    birthStatus: 'unknown',
    abilities: {
      ...DEFAULT_ABILITIES,
      valor: 0,
      command: 0,
      numeracy: 0,
      learning: 0,
      charisma: 0,
      insight: 0,
    },
    aptitudes: {
      ...DEFAULT_ABILITIES,
      valor: 0,
      command: 0,
      numeracy: 0,
      learning: 0,
      charisma: 0,
      insight: 0,
    },
    traits: { ambition: 0, caution: 0 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
  }
  const anon: House = {
    id: ANONYMOUS_HOUSE_ID,
    name: 'Anonymous',
    active: true,
    kind: 'system',
    memberIds: [PLACEHOLDER_PERSON_ID],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-anon' as ProvinceId,
  }
  return {
    currentYear: 1000,
    currentWeekOfYear: 1,
    absoluteWeek: 48000,
    provinces: {},
    holdings: {},
    states: {
      ['sr-0' as StateRegionId]: {
        id: 'sr-0' as StateRegionId,
        name: 'Default Region',
        provinceIds: [],
        gridCol: 0,
        gridRow: 0,
      },
    },
    polities: {},
    houses: { [ANONYMOUS_HOUSE_ID]: anon },
    persons: { [PLACEHOLDER_PERSON_ID]: placeholderSingleton },
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    actorIntents: {},
    diplomaticPlays: {},
    nextActorIntentId: 0,
    nextDiplomaticPlayId: 0,
  }
}

export function withProvince(
  state: WorldState,
  id: ProvinceId,
  overrides: Partial<Province> = {},
): WorldState {
  const holdingId = createHoldingId(Object.keys(state.holdings).length)
  // Extract Holding-specific overrides (Province no longer has development/polityControl)
  const anyOverrides = overrides as Record<string, unknown>
  const holding: Holding = {
    id: holdingId,
    provinceId: id,
    kind: 'manor',
    name: (anyOverrides.name as string) ?? 'P',
    development: (anyOverrides.development as number) ?? 1,
    polityControl: (anyOverrides.polityControl as number) ?? 100,
    landQuality: (anyOverrides.habitability as number) ?? 50,
    weight: 1,
  }
  const province: Province = {
    id,
    stateId: 'sr-0' as StateRegionId,
    name: 'P',
    x: 0,
    y: 0,
    neighbors: [],
    habitability: 50,
    popGroupIds: [],
    ...overrides,
    holdingIds: overrides.holdingIds ?? [holdingId],
  }
  let nextState: WorldState = {
    ...state,
    provinces: { ...state.provinces, [id]: province },
    holdings: { ...state.holdings, [holdingId]: holding },
  }
  const stateRegionId = province.stateId
  const sr = nextState.states[stateRegionId]
  if (sr) {
    const nextSr: StateRegion = { ...sr, provinceIds: [...sr.provinceIds, id] }
    nextState = { ...nextState, states: { ...nextState.states, [stateRegionId]: nextSr } }
  }
  return nextState
}

export function withHolding(
  state: WorldState,
  holdingId: HoldingId,
  provinceId: ProvinceId,
  overrides: Partial<Holding> = {},
): WorldState {
  const holding: Holding = {
    id: holdingId,
    provinceId,
    kind: 'manor',
    name: 'H',
    development: 1,
    polityControl: 100,
    landQuality: 50,
    weight: 1,
    ...overrides,
  }
  const province = state.provinces[provinceId]
  const updatedProvince = province
    ? { ...province, holdingIds: [...province.holdingIds, holdingId] }
    : province
  return {
    ...state,
    holdings: { ...state.holdings, [holdingId]: holding },
    ...(updatedProvince
      ? { provinces: { ...state.provinces, [provinceId]: updatedProvince } }
      : {}),
  }
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
  const province = state.provinces[provinceId]
  const contractId = ('lc-' + state.nextLandContractId) as LandContractId
  const firstHoldingId = province.holdingIds[0]
  const contract: LandContract = {
    id: contractId,
    provinceId,
    ...(firstHoldingId ? { holdingId: firstHoldingId } : {}),
    rootAuthorityId: ROOT_WORLD,
    granteePolityId: polityId,
    terms: { taxRateToGrantor: 0 },
  }
  const granteeSlot = state.landContractIndex.byGranteePolity[polityId] ?? []
  const byHolding = { ...state.landContractIndex.byHolding }
  for (const hid of province.holdingIds) {
    byHolding[hid] = [contractId]
  }
  const holdingCache = { ...state.holdingTerminalPolityCache }
  for (const hid of province.holdingIds) {
    holdingCache[hid] = polityId
  }
  let nextState: WorldState = {
    ...state,
    landContracts: { ...state.landContracts, [contractId]: contract },
    landContractIndex: {
      byProvince: { ...state.landContractIndex.byProvince, [provinceId]: [contractId] },
      byHolding,
      byGranteePolity: {
        ...state.landContractIndex.byGranteePolity,
        [polityId]: [...granteeSlot, contractId],
      },
      byParent: { ...state.landContractIndex.byParent },
    },
    holdingTerminalPolityCache: holdingCache,
    nextLandContractId: state.nextLandContractId + 1,
  }
  for (const holdingId of province.holdingIds) {
    const hoaId = ('ho-' + nextState.nextHoldingOfficeAssignmentId) as HoldingOfficeAssignmentId
    const hoa: HoldingOfficeAssignment = {
      id: hoaId,
      holdingId,
      role: 'bailiff',
      holderPersonId: PLACEHOLDER_PERSON_ID,
      appointingPolityId: polityId,
      active: true,
      startYear: nextState.currentYear,
      startWeek: nextState.absoluteWeek,
      unpaidCount: 0,
    }
    nextState = {
      ...nextState,
      holdingOfficeAssignments: { ...nextState.holdingOfficeAssignments, [hoaId]: hoa },
      holdingOfficeIndex: {
        ...nextState.holdingOfficeIndex,
        byHolding: { ...nextState.holdingOfficeIndex.byHolding, [holdingId]: hoaId },
        byAppointingPolity: {
          ...nextState.holdingOfficeIndex.byAppointingPolity,
          [polityId]: [...(nextState.holdingOfficeIndex.byAppointingPolity[polityId] ?? []), hoaId],
        },
      },
      nextHoldingOfficeAssignmentId: nextState.nextHoldingOfficeAssignmentId + 1,
    }
  }
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

// Convenience: void unused-vars compiler complaint for HoldingOfficeAssignmentId
// (kept as documented type alias for callers that want strong typing).
export type _HoldingOfficeAssignmentIdAlias = HoldingOfficeAssignmentId
