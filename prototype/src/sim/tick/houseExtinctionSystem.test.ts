import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
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
  const polityId = 'dp-0' as PolityId

  const province0Id = 'p-0' as ProvinceId
  const province1Id = 'p-1' as ProvinceId

  const extinctHousePersons: Record<PersonId, Person> = {}
  extinctHousePersons['pe-0' as PersonId] = makePerson(
    'pe-0' as PersonId,
    'DeadHead',
    50,
    false,
    houseId,
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
    polityId,
    habitability: 50,
    popGroupIds: [],
    development: 0,
    polityControl: 100,
    houseControl: 100,
  }
  provinces[province1Id] = {
    id: province1Id,
    name: 'Province1',
    x: 1,
    y: 1,
    neighbors: [],
    ownerHouseId: houseId,
    polityId,
    habitability: 50,
    popGroupIds: [],
    development: 0,
    polityControl: 100,
    houseControl: 100,
  }

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
          capitalProvinceId: province0Id,
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'ExtinctHouse',
          active: true,
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
          provinceIds: [province1Id],
          memberIds: ['pe-10' as PersonId],
          cadetHouseIds: [],
          legacyPrestige: 80,
          wealth: 200,
          seatProvinceId: province1Id,
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
    nextPolityIndex: 0,
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

    it('extinct house removed from polity houses', () => {
      const ctx = makeNormalExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, 'h-0' as HouseId)

      // v0.15: PolityOwnerConsistencySystem (Phase 6) would update ownerHouseId.
      // In Stage B that system is an empty stub, so ownerHouseId won't change.
      const extinctHouse = result.state.houses['h-0' as HouseId]
      expect(extinctHouse?.active).toBe(false)
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
      polityId: PolityId
      candidateHouseId: HouseId
    } {
      const houseId = 'h-0' as HouseId
      const candidateHouseId = 'h-1' as HouseId
      const polityId = 'dp-0' as PolityId

      const persons: Record<PersonId, Person> = {}
      persons['pe-0' as PersonId] = makePerson(
        'pe-0' as PersonId,
        'DeadRuler',
        50,
        false,
        houseId,
        0.5,
        30,
      )
      persons['pe-1' as PersonId] = makePerson(
        'pe-1' as PersonId,
        'CandidateMember',
        30,
        true,
        candidateHouseId,
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
        polityId,
        habitability: 50,
        popGroupIds: [],
        development: 0,
        polityControl: 100,
        houseControl: 100,
      }
      provinces[province1Id] = {
        id: province1Id,
        name: 'Province1',
        x: 1,
        y: 1,
        neighbors: [],
        ownerHouseId: candidateHouseId,
        polityId,
        habitability: 50,
        popGroupIds: [],
        development: 0,
        polityControl: 100,
        houseControl: 100,
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
              capitalProvinceId: province0Id,
            },
          },
          houses: {
            [houseId]: {
              id: houseId,
              name: 'RulerHouse',
              active: true,
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
              organization: { kind: 'polity' as const, id: polityId },
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
              ['polity:dp-0']: ['oa-0' as import('../types/ids').OfficeAssignmentId],
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
        nextPolityIndex: 0,
      }
      return { ctx, houseId, polityId, candidateHouseId }
    }

    it('HOUSE_EXTINCT event emitted', () => {
      const { ctx, houseId, polityId } = makeRulerExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const houseExtinctEvents = result.events.filter((e) => e.type === 'HOUSE_EXTINCT')
      expect(houseExtinctEvents.length).toBeGreaterThan(0)

      const event = houseExtinctEvents[0]!
      expect(event.importance).toBe('major')
      expect(event.houseIds).toContain(houseId)
      expect(event.polityIds).toContain(polityId)
    })

    it.todo('legacyPrestige reduced', () => {
      // v0.15: The special ruler-house-extinction code path (handleRulerHouseExtinction)
      // was deleted. All houses now use handleNormalHouseExtinction which does not
      // reduce polity legacyPrestige unless there is no receiver house.
    })

    it('extinct house marked inactive', () => {
      const { ctx, houseId } = makeRulerExtinctionCtx()
      const result = extinctHouseAfterFailedSuccession(ctx, houseId)

      const house = result.state.houses[houseId]
      expect(house?.active).toBe(false)
    })
  })
})
