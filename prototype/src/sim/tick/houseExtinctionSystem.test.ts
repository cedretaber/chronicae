import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, CountryId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { extinctHouseAfterFailedSuccession } from './houseExtinctionSystem'

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
  countryId: CountryId,
  ambition: number,
  legacyPrestige: number,
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
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition, caution: 0.5 },
    legacyPrestige,
    wealth: 0,
    attitudes: {},
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
          houseIds: [houseId, rulerHouseId],
          treasury: 100,
          legacyPrestige: 50,
          adminPower: 50,
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
          cadetHouseIds: [],
          legacyPrestige: 50,
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
          cadetHouseIds: [],
          legacyPrestige: 80,
          wealth: 200,
          seatProvinceId: province0Id,
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
    rng: createRng('extinction-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 11,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
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
    function makeRulerExtinctionCtx(): {
      ctx: TickContext
      houseId: HouseId
      countryId: CountryId
      candidateHouseId: HouseId
    } {
      const houseId = 'h-0' as HouseId
      const candidateHouseId = 'h-1' as HouseId
      const countryId = 'c-0' as CountryId

      const persons: Record<PersonId, Person> = {}
      persons['pe-0' as PersonId] = makePerson(
        'pe-0' as PersonId,
        'DeadRuler',
        50,
        false,
        houseId,
        countryId,
        0.5,
        30,
      )
      persons['pe-1' as PersonId] = makePerson(
        'pe-1' as PersonId,
        'CandidateMember',
        30,
        true,
        candidateHouseId,
        countryId,
        0.5,
        40,
      )

      const provinces: Record<ProvinceId, import('../types/province').Province> = {}
      const province0Id = 'p-0' as ProvinceId
      const province1Id = 'p-1' as ProvinceId
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
        ownerHouseId: candidateHouseId,
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
              houseIds: [houseId, candidateHouseId],
              treasury: 100,
              legacyPrestige: 50,
              adminPower: 50,
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
              cadetHouseIds: [],
              legacyPrestige: 90,
              wealth: 100,
              seatProvinceId: province0Id,
            },
            [candidateHouseId]: {
              id: candidateHouseId,
              name: 'CandidateHouse',
              active: true,
              countryId,
              provinceIds: [province1Id],
              memberIds: ['pe-1' as PersonId],
              cadetHouseIds: [],
              legacyPrestige: 40,
              wealth: 50,
              seatProvinceId: province1Id,
            },
          },
          persons,
          activePlots: {},
          popGroups: {},
          organizationShares: {},
          officeAssignments: {
            ['oa-0' as import('../types/ids').OfficeAssignmentId]: {
              id: 'oa-0' as import('../types/ids').OfficeAssignmentId,
              organization: { kind: 'country' as const, id: countryId },
              role: 'leader' as const,
              holderPersonId: 'pe-0' as PersonId,
              active: true,
              startYear: 10,
              unpaidCount: 0,
            },
          },
          shareIndex: { byOrganization: {}, byHolder: {} },
          officeIndex: {
            byOrganization: {
              ['country:c-0']: ['oa-0' as import('../types/ids').OfficeAssignmentId],
            },
            byHolderPerson: {},
          },
          nextOrganizationShareId: 0,
          nextOfficeAssignmentId: 1,
        },
        rng: createRng('ruler-extinction-test'),
        config: defaultConfig,
        events: [],
        nextEventIndex: 0,
        deathsThisTick: [],
        deathRolesThisTick: {},
        nextPersonIndex: 2,
        nextHouseIndex: 0,
        nextCountryIndex: 0,
      }
      return { ctx, houseId, countryId, candidateHouseId }
    }

    it('HOUSE_EXTINCT event emitted', () => {
      const { ctx, houseId, countryId } = makeRulerExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const houseExtinctEvents = result.events.filter((e) => e.type === 'HOUSE_EXTINCT')
      expect(houseExtinctEvents.length).toBeGreaterThan(0)

      const event = houseExtinctEvents[0]!
      expect(event.importance).toBe('major')
      expect(event.houseIds).toContain(houseId)
      expect(event.countryIds).toContain(countryId)
    })

    it('legacyPrestige reduced', () => {
      const { ctx, houseId, countryId } = makeRulerExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const country = result.state.countries[countryId]
      if (country) {
        expect(country.legacyPrestige).toBeLessThan(50)
      }
    })

    it('extinct house marked inactive', () => {
      const { ctx, houseId } = makeRulerExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const house = result.state.houses[houseId]
      expect(house?.active).toBe(false)
    })
  })
})
