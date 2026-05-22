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
import type { Holding, HoldingOfficeAssignment } from './types/landContract'
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
import { ROOT_WORLD } from './types/landContract'
import { ANONYMOUS_HOUSE_ID } from './types/house'
import { PLACEHOLDER_PERSON_ID } from './types/person'

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
    nameKey: 'anonymous',
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
    nameKey: 'anonymous',
    active: true,
    kind: 'system',
    memberIds: [PLACEHOLDER_PERSON_ID],
    deceasedMemberIds: [],
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
        nameKey: 'default_region',
        provinceIds: [],
        centerX: 0,
        centerY: 0,
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
    development: (anyOverrides.development as number) ?? 1,
    polityControl: (anyOverrides.polityControl as number) ?? 100,
    landQuality: (anyOverrides.habitability as number) ?? 50,
    weight: 1,
  }
  // Auto-link to existing provinces in the same state as bidirectional neighbors
  const stateRegionId = (overrides.stateId ?? 'sr-0') as StateRegionId
  const existingProvIds = Object.values(state.provinces)
    .filter((p) => p && (p.stateId as string) === (stateRegionId as string))
    .map((p) => p.id)
  const autoNeighbors = overrides.neighbors ?? existingProvIds

  const province: Province = {
    id,
    stateId: stateRegionId,
    nameKey: 'p',
    x: 0,
    y: 0,
    neighbors: autoNeighbors,
    habitability: 50,
    popGroupIds: [],
    ...overrides,
    holdingIds: overrides.holdingIds ?? [holdingId],
  }
  const updatedProvinces: Record<ProvinceId, Province> = { ...state.provinces, [id]: province }
  // Add reverse neighbor links
  if (!overrides.neighbors) {
    for (const existingId of existingProvIds) {
      const existing = updatedProvinces[existingId]
      if (existing && !existing.neighbors.includes(id)) {
        updatedProvinces[existingId] = { ...existing, neighbors: [...existing.neighbors, id] }
      }
    }
  }
  let nextState: WorldState = {
    ...state,
    provinces: updatedProvinces,
    holdings: { ...state.holdings, [holdingId]: holding },
  }
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
    nameKey: 'c',
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
    nameKey: 'h',
    active: true,
    memberIds: [],
    deceasedMemberIds: [],
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
    nameKey: 'p',
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
  let nextLcId = state.nextLandContractId
  const newContracts = { ...state.landContracts }
  const byHolding = { ...state.landContractIndex.byHolding }
  const holdingCache = { ...state.holdingTerminalPolityCache }
  let granteeSlot = [...(state.landContractIndex.byGranteePolity[polityId] ?? [])]
  let firstContractId: LandContractId | undefined

  for (const hid of province.holdingIds) {
    const contractId = ('lc-' + nextLcId) as LandContractId
    nextLcId++
    if (!firstContractId) firstContractId = contractId
    newContracts[contractId] = {
      id: contractId,
      provinceId,
      holdingId: hid,
      rootAuthorityId: ROOT_WORLD,
      granteePolityId: polityId,
      terms: { taxRateToGrantor: 0 },
    }
    byHolding[hid] = [contractId]
    holdingCache[hid] = polityId
    granteeSlot = [...granteeSlot, contractId]
  }

  if (!firstContractId && province.holdingIds.length === 0) {
    firstContractId = ('lc-' + nextLcId) as LandContractId
    nextLcId++
    newContracts[firstContractId] = {
      id: firstContractId,
      provinceId,
      rootAuthorityId: ROOT_WORLD,
      granteePolityId: polityId,
      terms: { taxRateToGrantor: 0 },
    }
    granteeSlot = [...granteeSlot, firstContractId]
  }

  let nextState: WorldState = {
    ...state,
    landContracts: newContracts,
    landContractIndex: {
      byProvince: {
        ...state.landContractIndex.byProvince,
        [provinceId]: firstContractId ? [firstContractId] : [],
      },
      byHolding,
      byGranteePolity: { ...state.landContractIndex.byGranteePolity, [polityId]: granteeSlot },
      byParent: { ...state.landContractIndex.byParent },
    },
    holdingTerminalPolityCache: holdingCache,
    nextLandContractId: nextLcId,
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
