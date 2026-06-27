import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createPersonId,
  createOfficeAssignmentId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId, OfficeAssignmentId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { expireOfficeTermAssignment } from './officeMutations'
import { createEmptyMerchantWorldSlices } from './merchantMutations'

const HOUSELESS_HOUSE_ID = 'h-anon' as HouseId

function makeOfficeState(): {
  state: WorldState
  officeId: OfficeAssignmentId
  holderId: PersonId
  houseId: HouseId
  polityId: PolityId
} {
  const polityId = createPolityId('c', 10)
  const houseId = createHouseId('h', 10)
  const holderId = createPersonId('pe', 10)
  const officeId = createOfficeAssignmentId(10)

  const anon = {
    id: HOUSELESS_HOUSE_ID,
    nameKey: 'Anonymous',
    active: true,
    kind: 'system' as const,
    memberIds: [],
    deceasedMemberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-anon' as ProvinceId,
  }
  const state: WorldState = {
    currentYear: 1450,
    currentWeekOfYear: 1,
    absoluteWeek: 75400,
    provinces: {},
    holdings: {},
    states: {},
    polities: {
      [polityId]: {
        id: polityId,
        nameSource: { kind: 'pool', nameKey: 'C' },
        rank: 2,
        treasury: 0,
        adminPower: 0,
        legacyPrestige: 0,
        active: true,
        capitalProvinceId: 'pr-0' as ProvinceId,
        ownerHouseId: houseId,
        origin: { kind: 'worldgen' },
      },
    },
    houses: {
      [HOUSELESS_HOUSE_ID]: anon,
      [houseId]: {
        id: houseId,
        nameKey: 'H',
        active: true,
        memberIds: [],
        deceasedMemberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 0,
        wealth: 0,
        seatProvinceId: 'pr-0' as ProvinceId,
      },
    },
    persons: {
      [holderId]: {
        id: holderId,
        nameKey: 'Holder',
        sex: 'male',
        age: 30,
        lifeStage: 'young_adulthood',
        alive: true,
        houseId,
        childIds: [],
        birthStatus: 'legitimate',
        abilities: {
          valor: 50,
          command: 50,
          numeracy: 50,
          learning: 50,
          charisma: 50,
          insight: 50,
        },
        aptitudes: {
          valor: 50,
          command: 50,
          numeracy: 50,
          learning: 50,
          charisma: 50,
          insight: 50,
        },
        traits: { ambition: 0.5, caution: 0.5 },
        legacyPrestige: 0,
        wealth: 0,
        attitudes: {},
      },
    },
    livingPersonIds: [holderId],
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
    officeAssignments: {
      [officeId]: {
        id: officeId,
        organization: { kind: 'polity' as const, id: polityId },
        role: 'administrator' as const,
        holderPersonId: holderId,
        active: true,
        startYear: 1440,
        slotIndex: 0,
        unpaidCount: 0,
      },
    },
    houseShareIndex: { byHouse: {}, byHolderPerson: {} },
    officeIndex: {
      byOrganization: { [`polity:${polityId}`]: [officeId] },
      byHolderPerson: { [holderId as string]: [officeId] },
    },
    nextHouseShareId: 0,
    nextOfficeAssignmentId: 11,
    landContracts: {},
    holdingOfficeAssignments: {},
    holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
    landContractIndex: { byHolding: {}, byGranteePolity: {}, byParent: {} },
    holdingTerminalPolityCache: {},
    polityIndex: { byOwnerHouse: { [houseId]: [polityId] } },
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
    regimentIndex: { byOwner: {}, byWar: {} },
    nextRegimentId: 0,
    regimentBarracks: {},
    regimentBarracksIndex: { byHolding: {}, byRegiment: {} },
    nextRegimentBarracksId: 0,
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
    ...createEmptyMerchantWorldSlices(),
    marketResourcePrices: {},
    monthlyHoldingResourceRevenue: {},
  }
  return { state, officeId, holderId, houseId, polityId }
}

describe('expireOfficeTermAssignment', () => {
  // v0.17.3 B: 削除セマンティクスに更新
  it('active office → deleted from state', () => {
    const { state, officeId, holderId, polityId } = makeOfficeState()
    const result = expireOfficeTermAssignment(state, officeId)
    expect(result.officeAssignments[officeId]).toBeUndefined()
    expect(result.officeIndex.byOrganization[`polity:${polityId}`]).toEqual([])
    expect(result.officeIndex.byHolderPerson[holderId as string]).toEqual([])
  })

  it('already deleted → unchanged', () => {
    const { state, officeId } = makeOfficeState()
    const first = expireOfficeTermAssignment(state, officeId)
    expect(first.officeAssignments[officeId]).toBeUndefined()
    const second = expireOfficeTermAssignment(first, officeId)
    expect(second).toBe(first)
  })

  it('missing office → unchanged', () => {
    const { state } = makeOfficeState()
    const missingId = createOfficeAssignmentId(99)
    const result = expireOfficeTermAssignment(state, missingId)
    expect(result).toBe(state)
  })
})
