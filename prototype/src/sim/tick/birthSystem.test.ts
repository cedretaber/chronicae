import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, CountryId, ProvinceId } from '../types/ids'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import { defaultConfig } from '../config/defaultConfig'
import { runBirthSystem } from './birthSystem'

function makePerson(
  id: PersonId,
  name: string,
  sex: 'male' | 'female',
  age: number,
  alive: boolean,
  houseId: HouseId,
  countryId: CountryId,
): Person {
  return {
    id,
    name,
    sex,
    age,
    alive,
    houseId,
    countryId,
    childIds: [],
    birthStatus: 'unknown',
    stats: { admin: 5, martial: 5 },
    traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
    prestige: 10,
  }
}

function makeBaseCtx(
  persons: Record<PersonId, Person>,
  houses: Record<HouseId, NonNullable<WorldState['houses'][HouseId]>>,
  countries: Record<CountryId, NonNullable<WorldState['countries'][CountryId]>>,
  month: number,
): TickContext {
  return {
    state: {
      currentYear: 1,
      currentMonth: month,
      provinces: {},
      countries,
      houses,
      persons,
      activePlots: {},
      popGroups: {},
    },
    rng: { seedText: 'test', state: 42 },
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
  }
}

function makeCountry(
  id: CountryId,
  houseId: HouseId,
): NonNullable<WorldState['countries'][CountryId]> {
  return {
    id,
    name: 'C',
    rulerHouseId: houseId,
    houseIds: [houseId],
    treasury: 100,
    legitimacy: 70,
    adminPower: 50,
    stability: 60,
    roleAssignments: {},
    active: true,
    capitalProvinceId: '' as ProvinceId,
  }
}

function makeHouse(id: HouseId, countryId: CountryId): NonNullable<WorldState['houses'][HouseId]> {
  return {
    id,
    name: 'H',
    active: true,
    countryId,
    provinceIds: [],
    memberIds: [],
    headId: '' as PersonId,
    cadetHouseIds: [],
    prestige: 50,
    cohesion: 60,
    loyaltyToCountry: 70,
    wealth: 100,
    seatProvinceId: '' as ProvinceId,
  }
}

function makeConfig(overrides: Partial<typeof defaultConfig> = {}): typeof defaultConfig {
  return { ...defaultConfig, ...overrides }
}

describe('runBirthSystem', () => {
  it('does nothing when currentMonth !== 1', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId, countryId)
    const mother = makePerson('pe-1' as PersonId, 'Jane', 'female', 28, true, houseId, countryId)
    mother.spouseId = father.id
    father.spouseId = mother.id
    const house = makeHouse(houseId, countryId)
    house.memberIds = [father.id, mother.id]
    house.headId = father.id
    const country = makeCountry(countryId, houseId)

    const ctx = makeBaseCtx(
      { [father.id]: father, [mother.id]: mother },
      { [houseId]: house },
      { [countryId]: country },
      6,
    )

    const result = runBirthSystem(ctx)

    expect(result.events.length).toBe(0)
    const keys = Object.keys(result.state.persons)
    expect(keys.length).toBe(2)
  })

  it('a father with a valid spouse produces a child', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId, countryId)
    const mother = makePerson('pe-1' as PersonId, 'Jane', 'female', 28, true, houseId, countryId)
    mother.spouseId = father.id
    father.spouseId = mother.id
    const house = makeHouse(houseId, countryId)
    house.memberIds = [father.id, mother.id]
    house.headId = father.id
    const country = makeCountry(countryId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 1.0,
      spouseMotherChance: 1.0,
    })

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
        countries: { [countryId]: country },
        houses: { [houseId]: house },
        persons: { [father.id]: father, [mother.id]: mother },
        activePlots: {},
        popGroups: {},
      },
      rng: { seedText: 'test', state: 42 },
      config: customConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 2,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = runBirthSystem(ctx)

    const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0' && k !== 'pe-1')
    expect(childKeys.length).toBeGreaterThan(0)

    if (childKeys.length > 0) {
      const childId = childKeys[0] as PersonId
      const child = result.state.persons[childId]
      expect(child).toBeDefined()
      expect(child?.fatherId).toBe('pe-0' as PersonId)
      expect(child?.birthStatus).toBe('legitimate')

      const fatherPerson = result.state.persons['pe-0' as PersonId]
      expect(fatherPerson?.childIds).toContain(childId)

      const motherPerson = result.state.persons['pe-1' as PersonId]
      expect(motherPerson?.childIds).toContain(childId)
    }
  })

  it('child born without spouse mother gets birthStatus illegitimate', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId, countryId)
    const house = makeHouse(houseId, countryId)
    house.memberIds = [father.id]
    house.headId = father.id
    const country = makeCountry(countryId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 1.0,
      spouseMotherChance: 0.0,
    })

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
        countries: { [countryId]: country },
        houses: { [houseId]: house },
        persons: { [father.id]: father },
        activePlots: {},
        popGroups: {},
      },
      rng: { seedText: 'test', state: 42 },
      config: customConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 2,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = runBirthSystem(ctx)

    const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0')
    expect(childKeys.length).toBeGreaterThan(0)

    if (childKeys.length > 0) {
      const childId = childKeys[0] as PersonId
      const child = result.state.persons[childId]
      expect(child?.birthStatus).toBe('illegitimate')
    }
  })

  it('child born to legitimate couple gets birthStatus legitimate', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId, countryId)
    const mother = makePerson('pe-1' as PersonId, 'Jane', 'female', 28, true, houseId, countryId)
    mother.spouseId = father.id
    father.spouseId = mother.id
    const house = makeHouse(houseId, countryId)
    house.memberIds = [father.id, mother.id]
    house.headId = father.id
    const country = makeCountry(countryId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 1.0,
      spouseMotherChance: 1.0,
    })

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {},
        countries: { [countryId]: country },
        houses: { [houseId]: house },
        persons: { [father.id]: father, [mother.id]: mother },
        activePlots: {},
        popGroups: {},
      },
      rng: { seedText: 'test', state: 42 },
      config: customConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 2,
      nextHouseIndex: 0,
      nextCountryIndex: 0,
    }

    const result = runBirthSystem(ctx)

    const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0' && k !== 'pe-1')
    expect(childKeys.length).toBeGreaterThan(0)

    if (childKeys.length > 0) {
      const childId = childKeys[0] as PersonId
      const child = result.state.persons[childId]
      expect(child?.birthStatus).toBe('legitimate')
    }
  })

  it('population multiplier applies when living persons <= criticalLivingPersons', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const father = makePerson('pe-0' as PersonId, 'John', 'male', 30, true, houseId, countryId)
    const house = makeHouse(houseId, countryId)
    house.memberIds = [father.id]
    house.headId = father.id
    const country = makeCountry(countryId, houseId)

    const customConfig = makeConfig({
      baseBirthChancePerMalePerYear: 0.3,
      criticalLivingPersons: 10,
      criticalPopulationBirthMultiplier: 3.0,
    })

    let birthsWithLowPop = 0
    let birthsNormalPop = 0

    for (let i = 0; i < 50; i++) {
      const ctx: TickContext = {
        state: {
          currentYear: 1,
          currentMonth: 1,
          provinces: {},
          countries: { [countryId]: country },
          houses: { [houseId]: house },
          persons: { [father.id]: { ...father } },
          activePlots: {},
          popGroups: {},
        },
        rng: { seedText: 'low-pop-' + i, state: 42 + i },
        config: customConfig,
        events: [],
        nextEventIndex: 0,
        nextPersonIndex: 1,
        nextHouseIndex: 0,
        nextCountryIndex: 0,
      }

      const result = runBirthSystem(ctx)
      const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0')
      if (childKeys.length > 0) birthsWithLowPop++
    }

    const normalConfig = makeConfig({
      baseBirthChancePerMalePerYear: 0.3,
      criticalLivingPersons: 0,
      targetLivingPersons: 0,
      criticalPopulationBirthMultiplier: 1.0,
      lowPopulationBirthMultiplier: 1.0,
    })

    for (let i = 0; i < 50; i++) {
      const ctx: TickContext = {
        state: {
          currentYear: 1,
          currentMonth: 1,
          provinces: {},
          countries: { [countryId]: country },
          houses: { [houseId]: house },
          persons: { [father.id]: { ...father } },
          activePlots: {},
          popGroups: {},
        },
        rng: { seedText: 'normal-pop-' + i, state: 42 + i },
        config: normalConfig,
        events: [],
        nextEventIndex: 0,
        nextPersonIndex: 1,
        nextHouseIndex: 0,
        nextCountryIndex: 0,
      }

      const result = runBirthSystem(ctx)
      const childKeys = Object.keys(result.state.persons).filter((k) => k !== 'pe-0')
      if (childKeys.length > 0) birthsNormalPop++
    }

    expect(birthsWithLowPop).toBeGreaterThan(birthsNormalPop)
  })
})
