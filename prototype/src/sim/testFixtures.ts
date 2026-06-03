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
  OfficeAssignmentId,
  HoldingId,
  StateRegionId,
  GoalId,
  AimId,
} from './types/ids'
import { createHoldingId } from './types/ids'
import { ROOT_WORLD } from './types/landContract'
import { PLACEHOLDER_PERSON_ID } from './types/person'
import type { Goal, Aim } from './types/goal'
import { decisionSubjectKey } from './types/goal'
import type { DecisionSubjectRef, GoalKind, AimKind } from './types/goal'

export function buildLivingPersonIds(persons: Record<PersonId, Person>): PersonId[] {
  return (Object.keys(persons) as PersonId[]).filter((id) => persons[id]?.alive).sort()
}

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
  // worldgen と整合 (placeholder は houseless)。
  const placeholderSingleton: Person = {
    id: PLACEHOLDER_PERSON_ID,
    nameKey: 'anonymous',
    sex: 'male',
    age: 30,
    lifeStage: 'mature_adulthood',
    alive: true,
    kind: 'placeholder',
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
    houses: {},
    persons: { [PLACEHOLDER_PERSON_ID]: placeholderSingleton },
    livingPersonIds: [PLACEHOLDER_PERSON_ID],
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: {} },
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {} },
    // v0.32 Clan
    clans: {},
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
    nextLandContractId: 0,
    nextHoldingOfficeAssignmentId: 0,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    // v0.27 HoldingImprovement
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
    // v0.26 Project system
    projects: {},
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
    diplomaticPlays: {},
    diplomaticOffers: {},
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    // v0.38 Chronicle System
    chronicleEntries: {},
    chronicleIndex: { byPerson: {}, byHouse: {}, byPolity: {}, byProvince: {}, byHolding: {} },
    nextChronicleEntryId: 0,
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
    // v0.32
    nextClanId: 1,
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
    nameKey: (anyOverrides.holdingNameKey as string) ?? 'h',
    kind: 'manor',
    polityControl: (anyOverrides.polityControl as number) ?? 100,
    landQuality: (anyOverrides.landQuality as number) ?? 50,
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
    terrain: 'plains',
    features: [],
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
    nameKey: 'h',
    kind: 'manor',
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
    nameSource: { kind: 'pool', nameKey: 'c' },
    rank: 2,
    treasury: 0,
    adminPower: 0,
    legacyPrestige: 0,
    active: true,
    capitalProvinceId: 'pr-0' as ProvinceId,
    origin: { kind: 'worldgen' },
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
    lifeStage: 'young_adulthood',
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
  const personHouseId = person.houseId
  const house = personHouseId ? state.houses[personHouseId] : undefined
  const houses = house
    ? {
        ...state.houses,
        [personHouseId!]: house.memberIds.includes(id)
          ? house
          : { ...house, memberIds: [...house.memberIds, id] },
      }
    : state.houses
  const livingPersonIds =
    person.alive && !state.livingPersonIds.includes(id)
      ? [...state.livingPersonIds, id].sort()
      : state.livingPersonIds
  return { ...state, persons: { ...state.persons, [id]: person }, houses, livingPersonIds }
}

// active な House には house:leader OfficeAssignment が 1 つ必要 (integritySystem check 3,
// 調査 §1.8)。fixture で house の当主役職を作り officeIndex を同期する。
export function withHouseLeader(
  state: WorldState,
  houseId: HouseId,
  leaderPersonId: PersonId,
): WorldState {
  const officeId = ('oa-' + state.nextOfficeAssignmentId) as OfficeAssignmentId
  const orgKey = 'house:' + houseId
  const holderKey = leaderPersonId as string
  return {
    ...state,
    officeAssignments: {
      ...state.officeAssignments,
      [officeId]: {
        id: officeId,
        organization: { kind: 'house', id: houseId },
        role: 'leader',
        holderPersonId: leaderPersonId,
        active: true,
        startYear: 1,
        unpaidCount: 0,
      },
    },
    officeIndex: {
      byOrganization: {
        ...state.officeIndex.byOrganization,
        [orgKey]: [...(state.officeIndex.byOrganization[orgKey] ?? []), officeId],
      },
      byHolderPerson: {
        ...state.officeIndex.byHolderPerson,
        [holderKey]: [...(state.officeIndex.byHolderPerson[holderKey] ?? []), officeId],
      },
    },
    nextOfficeAssignmentId: state.nextOfficeAssignmentId + 1,
  }
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
  const province = state.provinces[provinceId]
  // 調査 §4.1: byProvince 撤去。既存チェーンの有無は holding の byHolding チェーンで判定。
  const alreadyBound = province
    ? province.holdingIds.some((hid) => (state.landContractIndex.byHolding[hid] ?? []).length > 0)
    : false
  if (alreadyBound) {
    throw new Error(`bindProvinceToPolity: Province ${provinceId} already has a LandContract chain`)
  }
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
      contractedRemittanceRate: 0.4,
      expectedFeeRate: 0.1,
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

export function withGoal(
  state: WorldState,
  id: GoalId,
  owner: DecisionSubjectRef,
  kind: GoalKind,
  overrides: Partial<Goal> = {},
): WorldState {
  const goal: Goal = {
    id,
    owner,
    kind,
    priority: 1,
    progress: 0,
    targetProgress: 100,
    createdWeek: state.absoluteWeek,
    minimumUntilWeek: state.absoluteWeek + 144,
    lastReviewWeek: state.absoluteWeek,
    nextReviewWeek: state.absoluteWeek + 48,
    status: 'active',
    reasonIds: [],
    ...overrides,
  }
  const ownerKey = decisionSubjectKey(owner)
  const existingGoals = state.goalIndex.byOwner[ownerKey] ?? []
  return {
    ...state,
    goals: { ...state.goals, [id]: goal },
    goalIndex: {
      byOwner: {
        ...state.goalIndex.byOwner,
        [ownerKey]: [...existingGoals, id],
      },
    },
  }
}

export function withAim(
  state: WorldState,
  id: AimId,
  owner: DecisionSubjectRef,
  kind: AimKind,
  overrides: Partial<Aim> & { goalId?: GoalId } = {},
): WorldState {
  const aim: Aim = {
    id,
    owner,
    origin: 'goal_driven',
    kind,
    priority: 1,
    progress: 0,
    targetProgress: 1,
    createdWeek: state.absoluteWeek,
    deadlineWeek: state.absoluteWeek + 240,
    successfulProjectCount: 0,
    failedProjectCount: 0,
    status: 'active',
    reasonIds: [],
    ...overrides,
  }
  const ownerKey = decisionSubjectKey(owner)
  const existingOwnerAims = state.aimIndex.byOwner[ownerKey] ?? []
  const goalKey = aim.goalId ? (aim.goalId as string) : ''
  const existingGoalAims = goalKey ? (state.aimIndex.byGoal[goalKey] ?? []) : []
  return {
    ...state,
    aims: { ...state.aims, [id]: aim },
    aimIndex: {
      byOwner: {
        ...state.aimIndex.byOwner,
        [ownerKey]: [...existingOwnerAims, id],
      },
      byGoal: goalKey
        ? {
            ...state.aimIndex.byGoal,
            [goalKey]: [...existingGoalAims, id],
          }
        : state.aimIndex.byGoal,
    },
  }
}

// Convenience: void unused-vars compiler complaint for HoldingOfficeAssignmentId
// (kept as documented type alias for callers that want strong typing).
export type _HoldingOfficeAssignmentIdAlias = HoldingOfficeAssignmentId
