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
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'

function makeBaseState(): WorldState {
  const anon = {
    id: ANONYMOUS_HOUSE_ID,
    name: 'Anonymous',
    active: true,
    kind: 'system' as const,
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: 'pr-anon' as ProvinceId,
  }
  return {
    currentYear: 1450,
    currentMonth: 1,
    provinces: {},
    polities: {},
    houses: { [ANONYMOUS_HOUSE_ID]: anon },
    persons: {},
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
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
    actorIntents: {},
    diplomaticPlays: {},
    nextActorIntentId: 0,
    nextDiplomaticPlayId: 0,
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
  it('month != 1 → identity (no change)', () => {
    const state = makeBaseState()
    state.currentMonth = 6
    const ctx = makeCtx(state)
    const result = runOfficeTermSystem(ctx)
    expect(result.state).toBe(state)
    expect(result.events).toEqual([])
  })

  it('leader role + term beyond limit → unchanged', () => {
    const polityId = createPolityId('c', 0)
    const personId = createPersonId('pe', 0)
    const officeId = createOfficeAssignmentId(0)
    const houseId = createHouseId('h', 0)

    let state = makeBaseState()
    state.polities = {
      [polityId]: {
        id: polityId,
        name: 'C',
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
        name: 'H',
        active: true,
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 0,
        wealth: 0,
        seatProvinceId: 'pr-0' as ProvinceId,
      },
    }
    state.persons = {
      [personId]: {
        id: personId,
        name: 'Leader',
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
        name: 'C',
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
        name: 'H',
        active: true,
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 0,
        wealth: 0,
        seatProvinceId: 'pr-0' as ProvinceId,
      },
    }
    state.persons = {
      [personId]: {
        id: personId,
        name: 'Official',
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
        name: 'C',
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
        name: 'H',
        active: true,
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 0,
        wealth: 0,
        seatProvinceId: 'pr-0' as ProvinceId,
      },
    }
    state.persons = {
      [personId]: {
        id: personId,
        name: 'Official',
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
    expect(result.events[0]!.actorIds).toContain(personId)
    expect(result.events[0]!.houseIds).toContain(houseId)
    expect(result.events[0]!.polityIds).toContain(polityId)
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
        name: 'C',
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
        name: 'H',
        active: true,
        memberIds: [],
        cadetHouseIds: [],
        legacyPrestige: 0,
        wealth: 0,
        seatProvinceId: 'pr-0' as ProvinceId,
      },
    }
    state.persons = {
      [personId]: {
        id: personId,
        name: 'Official',
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
      id: ANONYMOUS_HOUSE_ID,
      name: 'Anonymous',
      active: true,
      kind: 'system' as const,
      memberIds: [],
      cadetHouseIds: [],
      legacyPrestige: 0,
      wealth: 0,
      seatProvinceId: 'pr-anon' as ProvinceId,
    }
    const state: WorldState = {
      currentYear: 1450,
      currentMonth: 1,
      provinces: {},
      polities: {
        [polityId]: {
          id: polityId,
          name: 'C',
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
        [ANONYMOUS_HOUSE_ID]: anon,
        [houseId]: {
          id: houseId,
          name: 'H',
          active: true,
          memberIds: [],
          cadetHouseIds: [],
          legacyPrestige: 0,
          wealth: 0,
          seatProvinceId: 'pr-0' as ProvinceId,
        },
      },
      persons: {
        [holderId]: {
          id: holderId,
          name: 'Holder',
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
      provinceOfficeAssignments: {},
      landContractIndex: { byProvince: {}, byGranteePolity: {}, byParent: {} },
      provinceTerminalPolityCache: {},
      provinceOfficeIndex: { byProvince: {}, byHolderPerson: {}, byAppointingPolity: {} },
      polityIndex: { byOwnerHouse: { [houseId]: [polityId] } },
      factions: {},
      factionMemberships: {},
      factionIndex: { byLeader: {}, byMember: {} },
      nextLandContractId: 0,
      nextProvinceOfficeAssignmentId: 0,
      nextFactionId: 0,
      nextFactionMembershipId: 0,
      actorIntents: {},
      diplomaticPlays: {},
      nextActorIntentId: 0,
      nextDiplomaticPlayId: 0,
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
