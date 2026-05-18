import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { Person } from '../types/person'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import { createOfficeAssignmentId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runSuccessionSystem } from './successionSystem'
import { applyMinorHeadPenalties } from './successionSystem'

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
  fatherId?: PersonId,
  motherId?: PersonId,
  childIds: PersonId[] = [],
  spouseId?: PersonId,
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
    attitudes: {},
    legacyPrestige,
    wealth: 0,
  }
  if (fatherId !== undefined) person.fatherId = fatherId
  if (motherId !== undefined) person.motherId = motherId
  if (spouseId !== undefined) person.spouseId = spouseId
  return person
}

function makeCtx(members: Person[], houseActive: boolean = true, month: number = 1): TickContext {
  const houseId = 'h-0' as HouseId
  const polityId = 'dp-0' as PolityId
  const provinceId = 'p-0' as ProvinceId

  const allPersons: Record<PersonId, Person> = {}
  const memberIds: PersonId[] = []

  for (const m of members) {
    allPersons[m.id] = m
    memberIds.push(m.id)
  }

  return {
    state: {
      currentYear: 1,
      currentMonth: month,
      provinces: {
        [provinceId]: {
          id: provinceId,
          name: 'Capital',
          x: 0,
          y: 0,
          neighbors: [],
          ownerHouseId: houseId,
          polityId,
          habitability: 50,
          popGroupIds: [],
          development: 10,
          polityControl: 100,
          houseControl: 100,
        },
      },
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
          capitalProvinceId: provinceId,
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'H0',
          active: houseActive,
          provinceIds: [provinceId],
          memberIds,
          cadetHouseIds: [],
          legacyPrestige: 50,
          wealth: 100,
          seatProvinceId: provinceId,
        },
      },
      persons: allPersons,
      activePlots: {},
      popGroups: {},
      organizationShares: {},
      officeAssignments: {},
      shareIndex: { byOrganization: {}, byHolder: {} },
      officeIndex: { byOrganization: {}, byHolderPerson: {} },
      nextOrganizationShareId: 0,
      nextOfficeAssignmentId: 0,
    },
    rng: createRng('succession-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: members.length,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
  }
}

describe('runSuccessionSystem', () => {
  it('skips houses that do not need succession (has leader office assignment)', () => {
    const head = makePerson('pe-0' as PersonId, 'Head', 50, true, 'h-0' as HouseId, 0.5, 30)
    const ctx = makeCtx([head])
    // Add leader office assignment so needsSuccession returns false
    const officeId = 'of-0' as import('../types/ids').OfficeAssignmentId
    const resultState: WorldState = {
      ...ctx.state,
      officeAssignments: {
        [officeId]: {
          id: officeId,
          organization: { kind: 'house' as const, id: 'h-0' as HouseId },
          role: 'leader' as const,
          holderPersonId: 'pe-0' as PersonId,
          active: true,
          startYear: 1,
          unpaidCount: 0,
        },
      },
      officeIndex: {
        byOrganization: { 'house:h-0': [officeId] },
        byHolderPerson: { 'pe-0': [officeId] },
      },
    }
    const resultCtx: TickContext = { ...ctx, state: resultState }

    const result = runSuccessionSystem(resultCtx)

    // No house succession events (house already has a leader), but a POLITY_LEADER_CHANGED
    // event is correctly emitted because the polity had no polity:leader office.
    expect(result.events.some((e) => e.type === 'HOUSE_LEADER_CHANGED')).toBe(false)
    expect(result.events.some((e) => e.type === 'POLITY_LEADER_CHANGED')).toBe(true)
    expect(result.events.length).toBe(1)
  })

  it('HOUSE_LEADER_CHANGED event emitted when succession occurs', () => {
    const adult = makePerson('pe-1' as PersonId, 'AdultChild', 30, true, 'h-0' as HouseId, 0.5, 10)
    const ctx = makeCtx([adult])

    const result = runSuccessionSystem(ctx)

    expect(result.events.some((e) => e.type === 'HOUSE_LEADER_CHANGED')).toBe(true)
  })

  it('minor becomes head when no adults exist', () => {
    const minor1 = makePerson('pe-1' as PersonId, 'MinorChild', 8, true, 'h-0' as HouseId, 0.3, 5)
    const minor2 = makePerson('pe-2' as PersonId, 'OlderMinor', 12, true, 'h-0' as HouseId, 0.4, 8)
    const ctx = makeCtx([minor1, minor2])

    const result = runSuccessionSystem(ctx)

    // The older minor (pe-2) should become the leader
    const officeIds = result.state.officeIndex.byOrganization['house:h-0'] ?? []
    const leaderOffice = officeIds
      .map((id) => result.state.officeAssignments[id])
      .find((o) => o?.active && o.role === 'leader')
    expect(leaderOffice?.holderPersonId).toBe('pe-2' as PersonId)
    expect(result.events.some((e) => e.type === 'HOUSE_LEADER_CHANGED')).toBe(true)
  })

  it('HOUSE_EXTINCT event when ruler house has no candidates', () => {
    const ctx = makeCtx([])

    const result = runSuccessionSystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.active).toBe(false)
    // v0.15: With no receiver house available (only house is extinct),
    // handleNormalHouseExtinction deactivates both house and polity
    const polity = result.state.polities['dp-0' as PolityId]
    expect(polity?.active).toBe(false)
    expect(result.events.some((e) => e.type === 'HOUSE_EXTINCT')).toBe(true)
  })

  it('SUCCESSION_CRISIS fires when top two scores are close', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId

    const pe1 = makePerson('pe-1' as PersonId, 'Candidate1', 30, true, houseId, 0.5, 10)
    const pe2 = makePerson('pe-2' as PersonId, 'Candidate2', 29, true, houseId, 0.5, 10)

    const persons: Record<PersonId, Person> = {}
    persons['pe-1' as PersonId] = pe1
    persons['pe-2' as PersonId] = pe2

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
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
            capitalProvinceId: '' as ProvinceId,
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            provinceIds: [],
            memberIds: ['pe-1' as PersonId, 'pe-2' as PersonId],
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
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
      },
      rng: createRng('succession-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 3,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const result = runSuccessionSystem(ctx)

    expect(result.events.some((e) => e.type === 'SUCCESSION_CRISIS')).toBe(true)
  })

  it('no SUCCESSION_CRISIS when score gap is large', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId

    const pe1 = makePerson('pe-1' as PersonId, 'HighScore', 30, true, houseId, 1.0, 100)
    const pe2 = makePerson('pe-2' as PersonId, 'LowScore', 29, true, houseId, 0.0, 0)

    const persons: Record<PersonId, Person> = {}
    persons['pe-1' as PersonId] = pe1
    persons['pe-2' as PersonId] = pe2

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
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
            capitalProvinceId: '' as ProvinceId,
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            provinceIds: [],
            memberIds: ['pe-1' as PersonId, 'pe-2' as PersonId],
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
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
      },
      rng: createRng('succession-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 3,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }

    const result = runSuccessionSystem(ctx)

    expect(result.events.some((e) => e.type === 'SUCCESSION_CRISIS')).toBe(false)
  })
})

describe('applyMinorHeadPenalties', () => {
  function makeMinorHeadCtx(
    houseId: HouseId,
    polityId: PolityId,
    age: number,
    config = defaultConfig,
  ): TickContext {
    const memberId = 'pe-0' as PersonId
    const member = makePerson(memberId, 'Member', age, true, houseId, 0.3, 10)
    const provinceId = 'p-0' as ProvinceId
    const baseCtx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {
          [provinceId]: {
            id: provinceId,
            name: 'Capital',
            x: 0,
            y: 0,
            neighbors: [],
            ownerHouseId: houseId,
            polityId,
            habitability: 50,
            popGroupIds: [],
            development: 10,
            polityControl: 100,
            houseControl: 100,
          },
        },
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
            capitalProvinceId: provinceId,
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            provinceIds: [provinceId],
            memberIds: [memberId],
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: provinceId,
          },
        },
        persons: { [memberId]: member },
        activePlots: {},
        popGroups: {},
        organizationShares: {},
        officeAssignments: {},
        shareIndex: { byOrganization: {}, byHolder: {} },
        officeIndex: { byOrganization: {}, byHolderPerson: {} },
        nextOrganizationShareId: 0,
        nextOfficeAssignmentId: 0,
      },
      rng: createRng('penalty-test'),
      config,
      events: [],
      nextEventIndex: 0,
      deathsThisTick: [],
      deathRolesThisTick: {},
      nextPersonIndex: 1,
      nextHouseIndex: 0,
      nextPolityIndex: 0,
    }
    // Add house leader office assignment so getHouseLeader returns memberId
    const officeId = createOfficeAssignmentId(0)
    const ctxWithLeader: TickContext = {
      ...baseCtx,
      state: {
        ...baseCtx.state,
        officeAssignments: {
          [officeId]: {
            id: officeId,
            organization: { kind: 'house', id: houseId },
            role: 'leader',
            holderPersonId: memberId,
            active: true,
            startYear: 1,
            unpaidCount: 0,
          },
        },
        officeIndex: {
          byOrganization: { [`house:${houseId as string}`]: [officeId] },
          byHolderPerson: { [memberId as string]: [officeId] },
        },
        nextOfficeAssignmentId: 1,
      },
    }
    return ctxWithLeader
  }

  it('reduces house and polity attitude scores for minor head member', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const memberId = 'pe-0' as PersonId

    const ctx = makeMinorHeadCtx(houseId, polityId, 10)
    const result = applyMinorHeadPenalties(ctx)

    const person = result.state.persons[memberId]
    const houseKey = `house:${houseId as string}`
    const polityKey = `polity:${polityId as string}`
    // respect toward house should decrease by minorHeadCohesionPenaltyPerMonth (0.5)
    expect(person?.attitudes[houseKey]?.respect).toBeCloseTo(
      -defaultConfig.minorHeadCohesionPenaltyPerMonth,
    )
    // affection toward polity should decrease by minorHeadLoyaltyPenaltyPerMonth (0.3)
    expect(person?.attitudes[polityKey]?.affection).toBeCloseTo(
      -defaultConfig.minorHeadLoyaltyPenaltyPerMonth,
    )
  })

  it('does not penalize adult head member', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const memberId = 'pe-0' as PersonId

    const ctx = makeMinorHeadCtx(houseId, polityId, 25)
    const result = applyMinorHeadPenalties(ctx)

    const person = result.state.persons[memberId]
    // adult head — attitudes should remain empty
    expect(person?.attitudes).toEqual({})
  })

  it('clamps attitude penalties to -100', () => {
    const houseId = 'h-0' as HouseId
    const polityId = 'dp-0' as PolityId
    const memberId = 'pe-0' as PersonId

    const bigPenaltyConfig = {
      ...defaultConfig,
      minorHeadCohesionPenaltyPerMonth: 200,
      minorHeadLoyaltyPenaltyPerMonth: 200,
    }
    const ctx = makeMinorHeadCtx(houseId, polityId, 5, bigPenaltyConfig)
    const result = applyMinorHeadPenalties(ctx)

    const person = result.state.persons[memberId]
    const houseKey = `house:${houseId as string}`
    const polityKey = `polity:${polityId as string}`
    expect(person?.attitudes[houseKey]?.respect).toBe(-100)
    expect(person?.attitudes[polityKey]?.affection).toBe(-100)
  })
})
