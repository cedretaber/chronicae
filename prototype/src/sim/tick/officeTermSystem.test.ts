import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createPersonId,
  createOfficeAssignmentId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId, OfficeAssignmentId, ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runOfficeTermSystem } from './officeTermSystem'
import { expireOfficeTermAssignment } from '../mutations/officeMutations'

const HOUSELESS_HOUSE_ID = 'h-anon' as HouseId

function makeBaseState(): WorldState {
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
  return {
    currentYear: 1450,
    currentWeekOfYear: 1,
    absoluteWeek: 75400,
    provinces: {},
    holdings: {},
    states: {},
    polities: {},
    houses: { [HOUSELESS_HOUSE_ID]: anon },
    persons: {},
    livingPersonIds: [],
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
    popIndex: { byHolding: {} },
    nextPopGroupId: 0,
    clans: {},
    nextClanId: 1,
  }
}

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 10,
    nextHouseIndex: 10,
    nextPolityIndex: 10,
  }
}

function makeOffice(
  state: WorldState,
  officeId: OfficeAssignmentId,
  orgKind: 'polity' | 'house',
  orgId: PolityId | HouseId,
  role: 'administrator' | 'treasurer' | 'military' | 'advisor' | 'leader',
  holderId: PersonId,
  startYear: number,
  active: boolean,
): WorldState {
  const orgKeyStr = `${orgKind}:${orgId}`
  const holderKey = holderId as string
  const officeIndex = {
    byOrganization: { ...state.officeIndex.byOrganization },
    byHolderPerson: { ...state.officeIndex.byHolderPerson },
  }
  const oKey = orgKeyStr
  const existingByOrg = officeIndex.byOrganization[oKey] ?? []
  officeIndex.byOrganization = {
    ...officeIndex.byOrganization,
    [oKey]: [...existingByOrg, officeId],
  }
  const existingByPerson = officeIndex.byHolderPerson[holderKey] ?? []
  officeIndex.byHolderPerson = {
    ...officeIndex.byHolderPerson,
    [holderKey]: [...existingByPerson, officeId],
  }
  return {
    ...state,
    nextOfficeAssignmentId: Math.max(
      state.nextOfficeAssignmentId,
      (officeId as unknown as number) + 1,
    ),
    officeAssignments: {
      ...state.officeAssignments,
      [officeId]: {
        id: officeId,
        organization: { kind: orgKind, id: orgId },
        role,
        holderPersonId: holderId,
        active,
        startYear,
        unpaidCount: 0,
      },
    },
    officeIndex,
  }
}

describe('runOfficeTermSystem', () => {
  it('leader role + term beyond limit → unchanged', () => {
    const polityId = createPolityId('c', 0)
    const personId = createPersonId('pe', 0)
    const officeId = createOfficeAssignmentId(0)
    const houseId = createHouseId('h', 0)

    let state = makeBaseState()
    state.polities = {
      [polityId]: {
        id: polityId,
        nameKey: 'C',
        rank: 2,
        treasury: 0,
        adminPower: 0,
        legacyPrestige: 0,
        active: true,
        capitalProvinceId: 'pr-0' as ProvinceId,
        ownerHouseId: houseId,
      },
    }
    state.houses = {
      ...state.houses,
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
    }
    state.persons = {
      [personId]: {
        id: personId,
        nameKey: 'Leader',
        sex: 'male',
        age: 30,
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
    }

    state = makeOffice(state, officeId, 'polity', polityId, 'leader', personId, 1400, true)

    const ctx = makeCtx(state)
    const result = runOfficeTermSystem(ctx)
    const office = result.state.officeAssignments[officeId]
    expect(office?.active).toBe(true)
    expect(result.events).toEqual([])
  })

  it('non-leader role, startYear = currentYear → unchanged (term not expired)', () => {
    const polityId = createPolityId('c', 1)
    const personId = createPersonId('pe', 1)
    const officeId = createOfficeAssignmentId(1)
    const houseId = createHouseId('h', 1)

    let state = makeBaseState()
    state.polities = {
      [polityId]: {
        id: polityId,
        nameKey: 'C',
        rank: 2,
        treasury: 0,
        adminPower: 0,
        legacyPrestige: 0,
        active: true,
        capitalProvinceId: 'pr-0' as ProvinceId,
        ownerHouseId: houseId,
      },
    }
    state.houses = {
      ...state.houses,
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
    }
    state.persons = {
      [personId]: {
        id: personId,
        nameKey: 'Official',
        sex: 'male',
        age: 30,
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
    }

    state = makeOffice(
      state,
      officeId,
      'polity',
      polityId,
      'administrator',
      personId,
      state.currentYear,
      true,
    )

    const ctx = makeCtx(state)
    const result = runOfficeTermSystem(ctx)
    const office = result.state.officeAssignments[officeId]
    expect(office?.active).toBe(true)
    expect(result.events).toEqual([])
  })

  it('non-leader role, startYear = currentYear - termYears → inactive + OFFICE_TERM_ENDED event', () => {
    const polityId = createPolityId('c', 2)
    const personId = createPersonId('pe', 2)
    const officeId = createOfficeAssignmentId(2)
    const houseId = createHouseId('h', 2)
    const termYears = defaultConfig.officeTermYears.polity.administrator

    let state = makeBaseState()
    state.polities = {
      [polityId]: {
        id: polityId,
        nameKey: 'C',
        rank: 2,
        treasury: 0,
        adminPower: 0,
        legacyPrestige: 0,
        active: true,
        capitalProvinceId: 'pr-0' as ProvinceId,
        ownerHouseId: houseId,
      },
    }
    state.houses = {
      ...state.houses,
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
    }
    state.persons = {
      [personId]: {
        id: personId,
        nameKey: 'Official',
        sex: 'male',
        age: 30,
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
    }

    state = makeOffice(
      state,
      officeId,
      'polity',
      polityId,
      'administrator',
      personId,
      state.currentYear - termYears,
      true,
    )

    const ctx = makeCtx(state)
    const result = runOfficeTermSystem(ctx)
    // v0.17.3 B: 任期切れは削除セマンティクス
    expect(result.state.officeAssignments[officeId]).toBeUndefined()
    expect(result.events.length).toBe(1)
    expect(result.events[0]!.type).toBe('OFFICE_TERM_ENDED')
    expect(result.events[0]!.entityRefs.some((r) => r.kind === 'person' && r.id === personId)).toBe(
      true,
    )
    expect(result.events[0]!.entityRefs.some((r) => r.kind === 'house' && r.id === houseId)).toBe(
      true,
    )
    expect(result.events[0]!.entityRefs.some((r) => r.kind === 'polity' && r.id === polityId)).toBe(
      true,
    )
  })

  it('inactive Office → not touched', () => {
    const polityId = createPolityId('c', 3)
    const personId = createPersonId('pe', 3)
    const officeId = createOfficeAssignmentId(3)
    const houseId = createHouseId('h', 3)
    const termYears = defaultConfig.officeTermYears.polity.administrator

    let state = makeBaseState()
    state.polities = {
      [polityId]: {
        id: polityId,
        nameKey: 'C',
        rank: 2,
        treasury: 0,
        adminPower: 0,
        legacyPrestige: 0,
        active: true,
        capitalProvinceId: 'pr-0' as ProvinceId,
        ownerHouseId: houseId,
      },
    }
    state.houses = {
      ...state.houses,
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
    }
    state.persons = {
      [personId]: {
        id: personId,
        nameKey: 'Official',
        sex: 'male',
        age: 30,
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
    }

    state = makeOffice(
      state,
      officeId,
      'polity',
      polityId,
      'administrator',
      personId,
      state.currentYear - termYears - 1,
      false,
    )

    const ctx = makeCtx(state)
    const result = runOfficeTermSystem(ctx)
    // v0.17.3 B: pre-existing inactive Office は state にも存在しないはず (state は新規生成、
    // active=true で開始) → fixture を再確認: makeBaseState は active=true で生成しているので、
    // ここでは「termYears 未満経過」もしくは「既に inactive 化されていた」ケースだが、
    // 新セマンティクスでは「inactive Office」は存在しない。実際の試験は state 上の office が
    // 削除されていない (= まだ termYears を満たしていない) ことを確認。
    const office = result.state.officeAssignments[officeId]
    expect(office).toBeDefined()
    expect(result.events).toEqual([])
  })
})

describe('expireOfficeTermAssignment', () => {
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
          nameKey: 'C',
          rank: 2,
          treasury: 0,
          adminPower: 0,
          legacyPrestige: 0,
          active: true,
          capitalProvinceId: 'pr-0' as ProvinceId,
          ownerHouseId: houseId,
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
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments: {
        [officeId]: {
          id: officeId,
          organization: { kind: 'polity' as const, id: polityId },
          role: 'administrator' as const,
          holderPersonId: holderId,
          active: true,
          startYear: 1440,
          unpaidCount: 0,
        },
      },
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: {
        byOrganization: { [`polity:${polityId}`]: [officeId] },
        byHolderPerson: { [holderId as string]: [officeId] },
      },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 11,
      landContracts: {},
      holdingOfficeAssignments: {},
      holdingOfficeIndex: { byHolding: {}, byHolderPerson: {}, byAppointingPolity: {} },
      landContractIndex: { byProvince: {}, byHolding: {}, byGranteePolity: {}, byParent: {} },
      holdingTerminalPolityCache: {},
      polityIndex: { byOwnerHouse: { [houseId]: [polityId] } },
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
      popIndex: { byHolding: {} },
      nextPopGroupId: 0,
      clans: {},
      nextClanId: 1,
    }
    return { state, officeId, holderId, houseId, polityId }
  }

  it('active office → deleted from state', () => {
    const { state, officeId } = makeOfficeState()
    const result = expireOfficeTermAssignment(state, officeId)
    expect(result.officeAssignments[officeId]).toBeUndefined()
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
