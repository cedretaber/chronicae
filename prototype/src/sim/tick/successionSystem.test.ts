import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, CountryId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runSuccessionSystem, applyMinorHeadPenalties } from './successionSystem'

function makePerson(
  id: PersonId,
  name: string,
  age: number,
  alive: boolean,
  houseId: HouseId,
  countryId: CountryId,
  admin: number,
  martial: number,
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
    countryId,
    childIds,
    birthStatus,
    stats: { admin, martial },
    traits: { ambition, caution: 0.5 },
    attitudes: {},
    legacyPrestige,
  }
  if (fatherId !== undefined) person.fatherId = fatherId
  if (motherId !== undefined) person.motherId = motherId
  if (spouseId !== undefined) person.spouseId = spouseId
  return person
}

function makeCtx(
  headId: PersonId,
  headAlive: boolean,
  members: Person[],
  houseActive: boolean = true,
  month: number = 1,
): TickContext {
  const houseId = 'h-0' as HouseId
  const countryId = 'c-0' as CountryId

  const head = makePerson(headId, 'Head', 50, headAlive, houseId, countryId, 5, 5, 0.5, 30)

  const allPersons: Record<PersonId, Person> = { [headId]: head }
  const memberIds: PersonId[] = [headId]

  for (const m of members) {
    allPersons[m.id] = m
    memberIds.push(m.id)
  }

  return {
    state: {
      currentYear: 1,
      currentMonth: month,
      provinces: {},
      countries: {
        [countryId]: {
          id: countryId,
          name: 'C0',
          rulerHouseId: houseId,
          houseIds: [houseId],
          treasury: 100,
          legacyPrestige: 50,
          adminPower: 50,
          roleAssignments: {},
          active: true,
          capitalProvinceId: '' as ProvinceId,
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'H0',
          active: houseActive,
          countryId,
          provinceIds: [],
          memberIds,
          headId,
          cadetHouseIds: [],
          legacyPrestige: 50,
          wealth: 100,
          seatProvinceId: '' as ProvinceId,
        },
      },
      persons: allPersons,
      activePlots: {},
      popGroups: {},
    },
    rng: createRng('succession-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: members.length + 1,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
  }
}

describe('runSuccessionSystem', () => {
  it('skips houses that do not need succession (alive head)', () => {
    const ctx = makeCtx('pe-0' as PersonId, true, [])
    const originalHeadId = ctx.state.houses['h-0' as HouseId]!.headId

    const result = runSuccessionSystem(ctx)

    const newHouse = result.state.houses['h-0' as HouseId]
    expect(newHouse?.headId).toBe(originalHeadId)
    expect(result.events.length).toBe(0)
  })

  it('adult candidate becomes head when head dies', () => {
    const ctx = makeCtx('pe-0' as PersonId, false, [
      makePerson(
        'pe-1' as PersonId,
        'AdultChild',
        30,
        true,
        'h-0' as HouseId,
        'c-0' as CountryId,
        5,
        5,
        0.5,
        10,
      ),
    ])

    const result = runSuccessionSystem(ctx)

    const newHouse = result.state.houses['h-0' as HouseId]
    expect(newHouse?.headId).toBe('pe-1' as PersonId)
    expect(result.events.some((e) => e.type === 'HOUSE_HEAD_CHANGED')).toBe(true)
  })

  it('minor becomes head when no adults exist', () => {
    const ctx = makeCtx('pe-0' as PersonId, false, [
      makePerson(
        'pe-1' as PersonId,
        'MinorChild',
        8,
        true,
        'h-0' as HouseId,
        'c-0' as CountryId,
        2,
        2,
        0.3,
        5,
      ),
      makePerson(
        'pe-2' as PersonId,
        'OlderMinor',
        12,
        true,
        'h-0' as HouseId,
        'c-0' as CountryId,
        3,
        3,
        0.4,
        8,
      ),
    ])

    const result = runSuccessionSystem(ctx)

    const newHouse = result.state.houses['h-0' as HouseId]
    expect(newHouse?.headId).toBe('pe-2' as PersonId)
    expect(result.events.some((e) => e.type === 'HOUSE_HEAD_CHANGED')).toBe(true)
  })

  it('ruler house with no candidates in isolated country collapses country', () => {
    const ctx = makeCtx('pe-0' as PersonId, false, [])

    const result = runSuccessionSystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house?.active).toBe(false)
    const country = result.state.countries['c-0' as CountryId]
    expect(country?.active).toBe(false)
    expect(result.events.some((e) => e.type === 'RULER_HOUSE_EXTINCT')).toBe(true)
  })

  it('SUCCESSION_CRISIS fires when top two scores are close', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const pe1 = makePerson(
      'pe-1' as PersonId,
      'Candidate1',
      30,
      true,
      houseId,
      countryId,
      5,
      5,
      0.5,
      10,
    )
    const pe2 = makePerson(
      'pe-2' as PersonId,
      'Candidate2',
      29,
      true,
      houseId,
      countryId,
      5,
      5,
      0.5,
      10,
    )

    const persons: Record<PersonId, Person> = {}
    persons['pe-0' as PersonId] = makePerson(
      'pe-0' as PersonId,
      'DeadHead',
      50,
      false,
      houseId,
      countryId,
      5,
      5,
      0.5,
      30,
    )
    persons['pe-1' as PersonId] = pe1
    persons['pe-2' as PersonId] = pe2

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
        countries: {
          [countryId]: {
            id: countryId,
            name: 'C0',
            rulerHouseId: houseId,
            houseIds: [houseId],
            treasury: 100,
            legacyPrestige: 50,
            adminPower: 50,
            roleAssignments: {},
            active: true,
            capitalProvinceId: '' as ProvinceId,
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            countryId,
            provinceIds: [],
            memberIds: ['pe-1' as PersonId, 'pe-2' as PersonId],
            headId: 'pe-0' as PersonId,
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
          },
        },
        persons,
        activePlots: {},
        popGroups: {},
      },
      rng: createRng('succession-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 3,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = runSuccessionSystem(ctx)

    expect(result.events.some((e) => e.type === 'SUCCESSION_CRISIS')).toBe(true)
  })

  it('no SUCCESSION_CRISIS when score gap is large', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const pe1 = makePerson(
      'pe-1' as PersonId,
      'HighScore',
      30,
      true,
      houseId,
      countryId,
      10,
      10,
      1.0,
      100,
    )
    const pe2 = makePerson(
      'pe-2' as PersonId,
      'LowScore',
      29,
      true,
      houseId,
      countryId,
      1,
      1,
      0.0,
      0,
    )

    const persons: Record<PersonId, Person> = {}
    persons['pe-0' as PersonId] = makePerson(
      'pe-0' as PersonId,
      'DeadHead',
      50,
      false,
      houseId,
      countryId,
      5,
      5,
      0.5,
      30,
    )
    persons['pe-1' as PersonId] = pe1
    persons['pe-2' as PersonId] = pe2

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
        countries: {
          [countryId]: {
            id: countryId,
            name: 'C0',
            rulerHouseId: houseId,
            houseIds: [houseId],
            treasury: 100,
            legacyPrestige: 50,
            adminPower: 50,
            roleAssignments: {},
            active: true,
            capitalProvinceId: '' as ProvinceId,
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            countryId,
            provinceIds: [],
            memberIds: ['pe-1' as PersonId, 'pe-2' as PersonId],
            headId: 'pe-0' as PersonId,
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
          },
        },
        persons,
        activePlots: {},
        popGroups: {},
      },
      rng: createRng('succession-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 3,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = runSuccessionSystem(ctx)

    expect(result.events.some((e) => e.type === 'SUCCESSION_CRISIS')).toBe(false)
  })
})

describe('applyMinorHeadPenalties', () => {
  function makeMinorHeadCtx(
    houseId: HouseId,
    countryId: CountryId,
    age: number,
    config = defaultConfig,
  ): TickContext {
    const memberId = 'pe-0' as PersonId
    const member = makePerson(memberId, 'Member', age, true, houseId, countryId, 2, 2, 0.3, 10)
    return {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
        countries: {
          [countryId]: {
            id: countryId,
            name: 'C0',
            rulerHouseId: houseId,
            houseIds: [houseId],
            treasury: 100,
            legacyPrestige: 50,
            adminPower: 50,
            roleAssignments: {},
            active: true,
            capitalProvinceId: '' as ProvinceId,
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: true,
            countryId,
            provinceIds: [],
            memberIds: [memberId],
            headId: memberId,
            cadetHouseIds: [],
            legacyPrestige: 50,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
          },
        },
        persons: { [memberId]: member },
        activePlots: {},
        popGroups: {},
      },
      rng: createRng('penalty-test'),
      config,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 1,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }
  }

  it('reduces house and country attitude scores for minor head member', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const memberId = 'pe-0' as PersonId

    const ctx = makeMinorHeadCtx(houseId, countryId, 10)
    const result = applyMinorHeadPenalties(ctx)

    const person = result.state.persons[memberId]
    const houseKey = `house:${houseId as string}`
    const countryKey = `country:${countryId as string}`
    // respect toward house should decrease by minorHeadCohesionPenaltyPerMonth (0.5)
    expect(person?.attitudes[houseKey]?.respect).toBeCloseTo(
      -defaultConfig.minorHeadCohesionPenaltyPerMonth,
    )
    // affection toward country should decrease by minorHeadLoyaltyPenaltyPerMonth (0.3)
    expect(person?.attitudes[countryKey]?.affection).toBeCloseTo(
      -defaultConfig.minorHeadLoyaltyPenaltyPerMonth,
    )
  })

  it('does not penalize adult head member', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const memberId = 'pe-0' as PersonId

    const ctx = makeMinorHeadCtx(houseId, countryId, 25)
    const result = applyMinorHeadPenalties(ctx)

    const person = result.state.persons[memberId]
    // adult head — attitudes should remain empty
    expect(person?.attitudes).toEqual({})
  })

  it('clamps attitude penalties to -100', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const memberId = 'pe-0' as PersonId

    const bigPenaltyConfig = {
      ...defaultConfig,
      minorHeadCohesionPenaltyPerMonth: 200,
      minorHeadLoyaltyPenaltyPerMonth: 200,
    }
    const ctx = makeMinorHeadCtx(houseId, countryId, 5, bigPenaltyConfig)
    const result = applyMinorHeadPenalties(ctx)

    const person = result.state.persons[memberId]
    const houseKey = `house:${houseId as string}`
    const countryKey = `country:${countryId as string}`
    expect(person?.attitudes[houseKey]?.respect).toBe(-100)
    expect(person?.attitudes[countryKey]?.affection).toBe(-100)
  })
})
