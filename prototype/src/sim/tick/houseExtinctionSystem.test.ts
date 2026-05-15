import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, CountryId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { extinctHouseAfterFailedSuccession } from './houseExtinctionSystem'

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
    birthStatus,
    stats: { admin, martial },
    traits: { ambition, loyaltyToCountry: 0.5, caution: 0.5 },
    prestige,
  }
}

function makeNormalExtinctionCtx(): TickContext {
  const houseId = 'h-0' as HouseId
  const rulerHouseId = 'h-1' as HouseId
  const countryId = 'c-0' as CountryId

  const province0Id = 'p-0' as ProvinceId
  const province1Id = 'p-1' as ProvinceId

  const extinctHousePersons: Record<PersonId, Person> = {}
  extinctHousePersons['pe-0' as PersonId] = makePerson(
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

  const rulerHousePersons: Record<PersonId, Person> = {}
  rulerHousePersons['pe-10' as PersonId] = makePerson(
    'pe-10' as PersonId,
    'RulerMember',
    30,
    true,
    rulerHouseId,
    countryId,
    5,
    5,
    0.5,
    30,
  )

  const allPersons: Record<PersonId, Person> = { ...extinctHousePersons, ...rulerHousePersons }

  const provinces: Record<ProvinceId, import('../types/province').Province> = {}
  provinces[province0Id] = {
    id: province0Id,
    name: 'Province0',
    x: 0,
    y: 0,
    neighbors: [],
    ownerHouseId: houseId,
    countryId,
    habitability: 50,
    popGroupIds: [],
    development: 0,
    countryControl: 100,
    houseControl: 100,
  }
  provinces[province1Id] = {
    id: province1Id,
    name: 'Province1',
    x: 1,
    y: 1,
    neighbors: [],
    ownerHouseId: houseId,
    countryId,
    habitability: 50,
    popGroupIds: [],
    development: 0,
    countryControl: 100,
    houseControl: 100,
  }

  return {
    state: {
      currentYear: 10,
      currentMonth: 6,
      provinces,
      countries: {
        [countryId]: {
          id: countryId,
          name: 'C0',
          rulerHouseId: rulerHouseId,
          houseIds: [houseId, rulerHouseId],
          treasury: 100,
          legitimacy: 70,
          adminPower: 50,
          stability: 60,
          roleAssignments: {},
          active: true,
          capitalProvinceId: province0Id,
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'ExtinctHouse',
          active: true,
          countryId,
          provinceIds: [province0Id, province1Id],
          memberIds: ['pe-0' as PersonId],
          headId: 'pe-0' as PersonId,
          cadetHouseIds: [],
          prestige: 50,
          cohesion: 60,
          loyaltyToCountry: 70,
          wealth: 100,
          seatProvinceId: province0Id,
        },
        [rulerHouseId]: {
          id: rulerHouseId,
          name: 'RulerHouse',
          active: true,
          countryId,
          provinceIds: [],
          memberIds: ['pe-10' as PersonId],
          headId: 'pe-10' as PersonId,
          cadetHouseIds: [],
          prestige: 80,
          cohesion: 70,
          loyaltyToCountry: 80,
          wealth: 200,
          seatProvinceId: province0Id,
        },
      },
      persons: allPersons,
      activePlots: {},
      popGroups: {},
    },
    rng: createRng('extinction-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 11,
  }
}

describe('extinctHouseAfterFailedSuccession', () => {
  describe('normal house extinction', () => {
    it('provinces transferred to ruler house', () => {
      const ctx = makeNormalExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, 'h-0' as HouseId)

      const extinctHouse = result.state.houses['h-0' as HouseId]
      expect(extinctHouse?.provinceIds.length).toBe(0)

      const rulerHouse = result.state.houses['h-1' as HouseId]
      expect(rulerHouse?.provinceIds.length).toBeGreaterThan(0)
    })

    it('HOUSE_EXTINCT event emitted', () => {
      const ctx = makeNormalExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, 'h-0' as HouseId)

      const extinctEvents = result.events.filter((e) => e.type === 'HOUSE_EXTINCT')
      expect(extinctEvents.length).toBeGreaterThan(0)

      const event = extinctEvents[0]!
      expect(event.importance).toBe('major')
      expect(event.houseIds).toContain('h-0' as HouseId)
    })

    it('extinct house marked inactive', () => {
      const ctx = makeNormalExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, 'h-0' as HouseId)

      const extinctHouse = result.state.houses['h-0' as HouseId]
      expect(extinctHouse?.active).toBe(false)
      expect(extinctHouse?.memberIds.length).toBe(0)
    })

    it('extinct house removed from country houseIds', () => {
      const ctx = makeNormalExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, 'h-0' as HouseId)

      const country = result.state.countries['c-0' as CountryId]
      expect(country?.houseIds).not.toContain('h-0' as HouseId)
    })

    it('province houseControl set to inherited value', () => {
      const ctx = makeNormalExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, 'h-0' as HouseId)

      const province = result.state.provinces['p-0' as ProvinceId]
      expect(province?.houseControl).toBe(defaultConfig.inheritedProvinceHouseControl)
    })
  })

  describe('ruler house extinction', () => {
    it('RULER_HOUSE_EXTINCT event emitted', () => {
      const houseId = 'h-0' as HouseId
      const countryId = 'c-0' as CountryId

      const persons: Record<PersonId, Person> = {}
      persons['pe-0' as PersonId] = makePerson(
        'pe-0' as PersonId,
        'DeadRuler',
        50,
        false,
        houseId,
        countryId,
        5,
        5,
        0.5,
        30,
      )

      const provinces: Record<ProvinceId, import('../types/province').Province> = {}
      const province0Id = 'p-0' as ProvinceId
      provinces[province0Id] = {
        id: province0Id,
        name: 'Province0',
        x: 0,
        y: 0,
        neighbors: [],
        ownerHouseId: houseId,
        countryId,
        habitability: 50,
        popGroupIds: [],
        development: 0,
        countryControl: 100,
        houseControl: 100,
      }

      const ctx: TickContext = {
        state: {
          currentYear: 10,
          currentMonth: 6,
          provinces,
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
              capitalProvinceId: province0Id,
            },
          },
          houses: {
            [houseId]: {
              id: houseId,
              name: 'RulerHouse',
              active: true,
              countryId,
              provinceIds: [province0Id],
              memberIds: ['pe-0' as PersonId],
              headId: 'pe-0' as PersonId,
              cadetHouseIds: [],
              prestige: 90,
              cohesion: 60,
              loyaltyToCountry: 70,
              wealth: 100,
              seatProvinceId: province0Id,
            },
          },
          persons,
          activePlots: {},
          popGroups: {},
        },
        rng: createRng('ruler-extinction-test'),
        config: defaultConfig,
        events: [],
        nextEventIndex: 0,
        nextPersonIndex: 1,
      }

      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const rulerEvents = result.events.filter((e) => e.type === 'RULER_HOUSE_EXTINCT')
      expect(rulerEvents.length).toBeGreaterThan(0)

      const event = rulerEvents[0]!
      expect(event.importance).toBe('major')
    })

    it('legitimacy and stability reduced', () => {
      const houseId = 'h-0' as HouseId
      const countryId = 'c-0' as CountryId

      const persons: Record<PersonId, Person> = {}
      persons['pe-0' as PersonId] = makePerson(
        'pe-0' as PersonId,
        'DeadRuler',
        50,
        false,
        houseId,
        countryId,
        5,
        5,
        0.5,
        30,
      )

      const provinces: Record<ProvinceId, import('../types/province').Province> = {}
      const province0Id = 'p-0' as ProvinceId
      provinces[province0Id] = {
        id: province0Id,
        name: 'Province0',
        x: 0,
        y: 0,
        neighbors: [],
        ownerHouseId: houseId,
        countryId,
        habitability: 50,
        popGroupIds: [],
        development: 0,
        countryControl: 100,
        houseControl: 100,
      }

      const ctx: TickContext = {
        state: {
          currentYear: 10,
          currentMonth: 6,
          provinces,
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
              capitalProvinceId: province0Id,
            },
          },
          houses: {
            [houseId]: {
              id: houseId,
              name: 'RulerHouse',
              active: true,
              countryId,
              provinceIds: [province0Id],
              memberIds: ['pe-0' as PersonId],
              headId: 'pe-0' as PersonId,
              cadetHouseIds: [],
              prestige: 90,
              cohesion: 60,
              loyaltyToCountry: 70,
              wealth: 100,
              seatProvinceId: province0Id,
            },
          },
          persons,
          activePlots: {},
          popGroups: {},
        },
        rng: createRng('ruler-extinction-test'),
        config: defaultConfig,
        events: [],
        nextEventIndex: 0,
        nextPersonIndex: 1,
      }

      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const country = result.state.countries[countryId]
      if (country) {
        expect(country.legitimacy).toBeLessThan(70)
        expect(country.stability).toBeLessThan(60)
      }
    })

    it('extinct house marked inactive', () => {
      const houseId = 'h-0' as HouseId
      const countryId = 'c-0' as CountryId

      const persons: Record<PersonId, Person> = {}
      persons['pe-0' as PersonId] = makePerson(
        'pe-0' as PersonId,
        'DeadRuler',
        50,
        false,
        houseId,
        countryId,
        5,
        5,
        0.5,
        30,
      )

      const provinces: Record<ProvinceId, import('../types/province').Province> = {}
      const province0Id = 'p-0' as ProvinceId
      provinces[province0Id] = {
        id: province0Id,
        name: 'Province0',
        x: 0,
        y: 0,
        neighbors: [],
        ownerHouseId: houseId,
        countryId,
        habitability: 50,
        popGroupIds: [],
        development: 0,
        countryControl: 100,
        houseControl: 100,
      }

      const ctx: TickContext = {
        state: {
          currentYear: 10,
          currentMonth: 6,
          provinces,
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
              capitalProvinceId: province0Id,
            },
          },
          houses: {
            [houseId]: {
              id: houseId,
              name: 'RulerHouse',
              active: true,
              countryId,
              provinceIds: [province0Id],
              memberIds: ['pe-0' as PersonId],
              headId: 'pe-0' as PersonId,
              cadetHouseIds: [],
              prestige: 90,
              cohesion: 60,
              loyaltyToCountry: 70,
              wealth: 100,
              seatProvinceId: province0Id,
            },
          },
          persons,
          activePlots: {},
          popGroups: {},
        },
        rng: createRng('ruler-extinction-test'),
        config: defaultConfig,
        events: [],
        nextEventIndex: 0,
        nextPersonIndex: 1,
      }

      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const house = result.state.houses[houseId]
      expect(house?.active).toBe(false)
      const country = result.state.countries[countryId]
      expect(country?.active).toBe(false)
    })
  })
})
