import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { maybeSplitHouseAfterSuccession } from './houseSplitSystem'
import type { SplitInput } from './houseSplitSystem'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(
  id: PersonId,
  name: string,
  age: number,
  alive: boolean,
  houseId: HouseId,
  ambition: number,
  legacyPrestige: number,
  sex: Person['sex'] = 'male',
  birthStatus: Person['birthStatus'] = 'legitimate',
  childIds: PersonId[] = [],
  spouseId?: PersonId,
  fatherId?: PersonId,
  motherId?: PersonId,
): Person {
  const person: Person = {
    id,
    name,
    sex,
    age,
    alive,
    houseId,
    childIds,
    birthStatus,
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition, caution: 0.5 },
    legacyPrestige,
    wealth: 0,
    attitudes: {},
  }
  if (spouseId !== undefined) person.spouseId = spouseId
  if (fatherId !== undefined) person.fatherId = fatherId
  if (motherId !== undefined) person.motherId = motherId
  return person
}

function makeSplitCtx(
  _cohesion: number,
  memberCount: number,
  provinceCount: number,
  houseSplitEnabled: boolean = true,
): TickContext {
  const houseId = 'h-0' as HouseId
  const polityId = 'dp-0' as PolityId

  const persons: Record<PersonId, Person> = {}
  const memberIds: PersonId[] = []

  for (let i = 0; i < memberCount; i++) {
    const pid = `pe-${i}` as PersonId
    persons[pid] = makePerson(pid, `Member${i}`, 30, true, houseId, 0.5, 10)
    memberIds.push(pid)
  }

  const provinces: Record<ProvinceId, import('../types/province').Province> = {}
  const provinceIds: ProvinceId[] = []

  for (let i = 0; i < provinceCount; i++) {
    const pid = `p-${i}` as ProvinceId
    provinces[pid] = {
      id: pid,
      name: `Province${i}`,
      x: i,
      y: i,
      neighbors: [],
      habitability: 50,
      popGroupIds: [],
      development: 0,
      polityControl: 100,
    }
    provinceIds.push(pid)
  }

  const config = { ...defaultConfig, houseSplitEnabled }

  return {
    state: {
      currentYear: 10,
      currentMonth: 6,
      provinces,
      polities: {
        [polityId]: {
          id: polityId,
          name: 'C0',
          rank: 2,
          ownerHouseId: houseId,
          treasury: 100,
          legacyPrestige: 50,
          adminPower: 50,
          active: true,
          capitalProvinceId: provinceIds[0] ?? ('' as ProvinceId),
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'H0',
          active: true,
          memberIds,
          cadetHouseIds: [],
          legacyPrestige: 50,
          wealth: 100,
          seatProvinceId: provinceIds[0] ?? ('' as ProvinceId),
        },
      },
      persons,
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
      nextLandContractId: 0,
      nextProvinceOfficeAssignmentId: 0,
    },
    rng: createRng('split-test'),
    config,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: memberCount,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

describe('maybeSplitHouseAfterSuccession', () => {
  it('no split when houseSplitEnabled is false', () => {
    const ctx = makeSplitCtx(10, 3, 5, false)
    const input: SplitInput = {
      houseId: 'h-0' as HouseId,
      successorId: 'pe-0' as PersonId,
      splitCandidates: [{ person: ctx.state.persons['pe-1' as PersonId]!, score: 50 }],
    }

    const result = maybeSplitHouseAfterSuccession(ctx, input)

    expect(result.events.filter((e) => e.type === 'HOUSE_SPLIT').length).toBe(0)
    const house = result.state.houses['h-0' as HouseId]
    expect(house?.cadetHouseIds.length).toBe(0)
  })

  it('no split when not enough provinces', () => {
    const ctx = makeSplitCtx(10, 3, 1)
    const input: SplitInput = {
      houseId: 'h-0' as HouseId,
      successorId: 'pe-0' as PersonId,
      splitCandidates: [{ person: ctx.state.persons['pe-1' as PersonId]!, score: 50 }],
    }

    const result = maybeSplitHouseAfterSuccession(ctx, input)

    expect(result.events.filter((e) => e.type === 'HOUSE_SPLIT').length).toBe(0)
  })

  it('no split when house cohesion >= threshold', () => {
    const ctx = makeSplitCtx(60, 3, 5)
    const input: SplitInput = {
      houseId: 'h-0' as HouseId,
      successorId: 'pe-0' as PersonId,
      splitCandidates: [{ person: ctx.state.persons['pe-1' as PersonId]!, score: 50 }],
    }

    const result = maybeSplitHouseAfterSuccession(ctx, input)

    expect(result.events.filter((e) => e.type === 'HOUSE_SPLIT').length).toBe(0)
  })

  it('split occurs when all conditions met with very high split chance', () => {
    const highSplitConfig = {
      ...defaultConfig,
      houseSplitEnabled: true,
      baseHouseSplitChance: 1.0,
      minProvincesForHouseSplit: 3,
      houseSplitCohesionThreshold: 60,
    }

    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId

    const persons: Record<PersonId, Person> = {}
    persons['pe-0' as PersonId] = makePerson('pe-0' as PersonId, 'Head', 30, true, houseId, 0.5, 10)
    persons['pe-1' as PersonId] = makePerson(
      'pe-1' as PersonId,
      'Splitter',
      25,
      true,
      houseId,
      0.9,
      80,
    )
    persons['pe-2' as PersonId] = makePerson(
      'pe-2' as PersonId,
      'Member2',
      30,
      true,
      houseId,
      0.5,
      10,
    )

    const provinceIds: ProvinceId[] = []
    const provinces: Record<ProvinceId, import('../types/province').Province> = {}
    for (let i = 0; i < 5; i++) {
      const pid = `p-${i}` as ProvinceId
      provinceIds.push(pid)
      provinces[pid] = {
        id: pid,
        name: `Province${i}`,
        x: i,
        y: i,
        neighbors: [],
        habitability: 50,
        popGroupIds: [],
        development: 0,
        polityControl: 100,
      }
    }

    const ctx: TickContext = {
      state: {
        currentYear: 10,
        currentMonth: 6,
        provinces,
        polities: {
          [polityId]: {
            id: polityId,
            name: 'C0',
            rank: 2,
            ownerHouseId: houseId,
            treasury: 100,
            legacyPrestige: 50,
            adminPower: 50,
            active: true,
            capitalProvinceId: provinceIds[0] ?? ('' as ProvinceId),
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            memberIds: ['pe-0' as PersonId, 'pe-1' as PersonId, 'pe-2' as PersonId],
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: provinceIds[0] ?? ('' as ProvinceId),
          },
        },
        persons,
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
        nextLandContractId: 0,
        nextProvinceOfficeAssignmentId: 0,
      },
      rng: createRng('split-deterministic'),
      config: highSplitConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 3,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const input: SplitInput = {
      houseId,
      successorId: 'pe-0' as PersonId,
      splitCandidates: [{ person: persons['pe-1' as PersonId]!, score: 50 }],
    }

    const result = maybeSplitHouseAfterSuccession(ctx, input)

    const splitEvents = result.events.filter((e) => e.type === 'HOUSE_SPLIT')
    expect(splitEvents.length).toBeGreaterThan(0)

    const crisisEvents = result.events.filter((e) => e.type === 'SUCCESSION_CRISIS')
    expect(crisisEvents.length).toBeGreaterThan(0)
  })

  it('splitter moves to new house', () => {
    const highSplitConfig = {
      ...defaultConfig,
      houseSplitEnabled: true,
      baseHouseSplitChance: 1.0,
      minProvincesForHouseSplit: 3,
      houseSplitCohesionThreshold: 60,
    }

    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId

    const persons: Record<PersonId, Person> = {}
    persons['pe-0' as PersonId] = makePerson('pe-0' as PersonId, 'Head', 30, true, houseId, 0.5, 10)
    persons['pe-1' as PersonId] = makePerson(
      'pe-1' as PersonId,
      'Splitter',
      25,
      true,
      houseId,
      0.9,
      80,
    )
    persons['pe-2' as PersonId] = makePerson(
      'pe-2' as PersonId,
      'Member2',
      30,
      true,
      houseId,
      0.5,
      10,
    )

    const provinceIds: ProvinceId[] = []
    const provinces: Record<ProvinceId, import('../types/province').Province> = {}
    for (let i = 0; i < 5; i++) {
      const pid = `p-${i}` as ProvinceId
      provinceIds.push(pid)
      provinces[pid] = {
        id: pid,
        name: `Province${i}`,
        x: i,
        y: i,
        neighbors: [],
        habitability: 50,
        popGroupIds: [],
        development: 0,
        polityControl: 100,
      }
    }

    const ctx: TickContext = {
      state: {
        currentYear: 10,
        currentMonth: 6,
        provinces,
        polities: {
          [polityId]: {
            id: polityId,
            name: 'C0',
            rank: 2,
            ownerHouseId: houseId,
            treasury: 100,
            legacyPrestige: 50,
            adminPower: 50,
            active: true,
            capitalProvinceId: provinceIds[0] ?? ('' as ProvinceId),
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            memberIds: ['pe-0' as PersonId, 'pe-1' as PersonId, 'pe-2' as PersonId],
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: provinceIds[0] ?? ('' as ProvinceId),
          },
        },
        persons,
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
        nextLandContractId: 0,
        nextProvinceOfficeAssignmentId: 0,
      },
      rng: createRng('split-deterministic'),
      config: highSplitConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 3,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const input: SplitInput = {
      houseId,
      successorId: 'pe-0' as PersonId,
      splitCandidates: [{ person: persons['pe-1' as PersonId]!, score: 50 }],
    }

    const result = maybeSplitHouseAfterSuccession(ctx, input)

    const newHouseIds = Object.keys(result.state.houses).filter((k) => k !== 'h-0')
    expect(newHouseIds.length).toBeGreaterThan(0)

    const newHouseId = newHouseIds[0] as HouseId
    const newHouse = result.state.houses[newHouseId]
    const houseOrgKey = `house:${newHouseId}` as const
    const officeIds = result.state.officeIndex.byOrganization[houseOrgKey] ?? []
    const leaderOffice = officeIds
      .map((id) => result.state.officeAssignments[id])
      .find((o) => o?.active && o.role === 'leader')
    expect(leaderOffice?.holderPersonId).toBe('pe-1' as PersonId)
    expect(newHouse?.memberIds).toContain('pe-1' as PersonId)
  })

  it('HOUSE_SPLIT event has correct fields', () => {
    const highSplitConfig = {
      ...defaultConfig,
      houseSplitEnabled: true,
      baseHouseSplitChance: 1.0,
      minProvincesForHouseSplit: 3,
      houseSplitCohesionThreshold: 60,
    }

    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId

    const persons: Record<PersonId, Person> = {}
    persons['pe-0' as PersonId] = makePerson('pe-0' as PersonId, 'Head', 30, true, houseId, 0.5, 10)
    persons['pe-1' as PersonId] = makePerson(
      'pe-1' as PersonId,
      'Splitter',
      25,
      true,
      houseId,
      0.9,
      80,
    )
    persons['pe-2' as PersonId] = makePerson(
      'pe-2' as PersonId,
      'Member2',
      30,
      true,
      houseId,
      0.5,
      10,
    )

    const provinceIds: ProvinceId[] = []
    const provinces: Record<ProvinceId, import('../types/province').Province> = {}
    for (let i = 0; i < 5; i++) {
      const pid = `p-${i}` as ProvinceId
      provinceIds.push(pid)
      provinces[pid] = {
        id: pid,
        name: `Province${i}`,
        x: i,
        y: i,
        neighbors: [],
        habitability: 50,
        popGroupIds: [],
        development: 0,
        polityControl: 100,
      }
    }

    const ctx: TickContext = {
      state: {
        currentYear: 10,
        currentMonth: 6,
        provinces,
        polities: {
          [polityId]: {
            id: polityId,
            name: 'C0',
            rank: 2,
            ownerHouseId: houseId,
            treasury: 100,
            legacyPrestige: 50,
            adminPower: 50,
            active: true,
            capitalProvinceId: provinceIds[0] ?? ('' as ProvinceId),
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            memberIds: ['pe-0' as PersonId, 'pe-1' as PersonId, 'pe-2' as PersonId],
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: provinceIds[0] ?? ('' as ProvinceId),
          },
        },
        persons,
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
        nextLandContractId: 0,
        nextProvinceOfficeAssignmentId: 0,
      },
      rng: createRng('split-deterministic'),
      config: highSplitConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 3,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const input: SplitInput = {
      houseId,
      successorId: 'pe-0' as PersonId,
      splitCandidates: [{ person: persons['pe-1' as PersonId]!, score: 50 }],
    }

    const result = maybeSplitHouseAfterSuccession(ctx, input)

    const splitEvents = result.events.filter((e) => e.type === 'HOUSE_SPLIT')
    expect(splitEvents.length).toBeGreaterThan(0)

    const event = splitEvents[0]!
    expect(event.importance).toBe('major')
    expect(event.actorIds).toContain('pe-1' as PersonId)
    expect(event.houseIds).toContain('h-0' as HouseId)
    expect(event.polityIds).toContain(polityId)
  })
})
