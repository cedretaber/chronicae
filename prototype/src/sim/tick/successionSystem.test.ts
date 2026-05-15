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
  prestige: number,
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
    traits: { ambition, loyaltyToCountry: 0.5, caution: 0.5 },
    prestige,
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
          legitimacy: 70,
          adminPower: 50,
          stability: 60,
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
          prestige: 50,
          cohesion: 60,
          loyaltyToCountry: 70,
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
            legitimacy: 70,
            adminPower: 50,
            stability: 60,
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
            prestige: 50,
            cohesion: 60,
            loyaltyToCountry: 70,
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
            legitimacy: 70,
            adminPower: 50,
            stability: 60,
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
            prestige: 50,
            cohesion: 60,
            loyaltyToCountry: 70,
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
  it('reduces cohesion and loyaltyToCountry for minor head', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const minorHead = makePerson(
      'pe-0' as PersonId,
      'MinorHead',
      10,
      true,
      houseId,
      countryId,
      2,
      2,
      0.3,
      10,
    )

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
            legitimacy: 70,
            adminPower: 50,
            stability: 60,
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
            memberIds: ['pe-0' as PersonId],
            headId: 'pe-0' as PersonId,
            cadetHouseIds: [],
            prestige: 50,
            cohesion: 60,
            loyaltyToCountry: 70,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
          },
        },
        persons: { ['pe-0' as PersonId]: minorHead },
        activePlots: {},
        popGroups: {},
      },
      rng: createRng('penalty-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 1,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = applyMinorHeadPenalties(ctx)

    const newHouse = result.state.houses[houseId]
    expect(newHouse?.cohesion).toBeLessThan(60)
    expect(newHouse?.loyaltyToCountry).toBeLessThan(70)
  })

  it('does not penalize adult head', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const adultHead = makePerson(
      'pe-0' as PersonId,
      'AdultHead',
      25,
      true,
      houseId,
      countryId,
      5,
      5,
      0.5,
      30,
    )

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
            legitimacy: 70,
            adminPower: 50,
            stability: 60,
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
            memberIds: ['pe-0' as PersonId],
            headId: 'pe-0' as PersonId,
            cadetHouseIds: [],
            prestige: 50,
            cohesion: 60,
            loyaltyToCountry: 70,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
          },
        },
        persons: { ['pe-0' as PersonId]: adultHead },
        activePlots: {},
        popGroups: {},
      },
      rng: createRng('penalty-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 1,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = applyMinorHeadPenalties(ctx)

    const newHouse = result.state.houses[houseId]
    expect(newHouse?.cohesion).toBe(60)
    expect(newHouse?.loyaltyToCountry).toBe(70)
  })

  it('clamps cohesion and loyaltyToCountry to min 0', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const minorHead = makePerson(
      'pe-0' as PersonId,
      'TinyMinor',
      5,
      true,
      houseId,
      countryId,
      2,
      2,
      0.3,
      10,
    )

    const lowConfig = {
      ...defaultConfig,
      minorHeadCohesionPenaltyPerMonth: 100,
      minorHeadLoyaltyPenaltyPerMonth: 100,
    }

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
            legitimacy: 70,
            adminPower: 50,
            stability: 60,
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
            memberIds: ['pe-0' as PersonId],
            headId: 'pe-0' as PersonId,
            cadetHouseIds: [],
            prestige: 50,
            cohesion: 10,
            loyaltyToCountry: 5,
            wealth: 100,
            seatProvinceId: '' as ProvinceId,
          },
        },
        persons: { ['pe-0' as PersonId]: minorHead },
        activePlots: {},
        popGroups: {},
      },
      rng: createRng('penalty-test'),
      config: lowConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 1,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = applyMinorHeadPenalties(ctx)

    const newHouse = result.state.houses[houseId]
    expect(newHouse?.cohesion).toBe(0)
    expect(newHouse?.loyaltyToCountry).toBe(0)
  })
})
