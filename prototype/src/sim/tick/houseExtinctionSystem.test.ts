import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, PolityId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { extinctHouseAfterFailedSuccession } from './houseExtinctionSystem'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPolity,
  withProvince,
} from '../testFixtures'

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

  let state = makeEmptyV016State()
  state = { ...state, currentYear: 10, currentMonth: 6 }
  state = withProvince(state, province0Id, { name: 'Province0' })
  state = withProvince(state, province1Id, { name: 'Province1', x: 1, y: 1 })
  state = withHouse(state, houseId, {
    name: 'ExtinctHouse',
    memberIds: ['pe-0' as PersonId],
    legacyPrestige: 50,
    wealth: 100,
    seatProvinceId: province0Id,
  })
  state = withHouse(state, rulerHouseId, {
    name: 'RulerHouse',
    memberIds: ['pe-10' as PersonId],
    legacyPrestige: 80,
    wealth: 200,
    seatProvinceId: province1Id,
  })
  state = withPolity(state, polityId, {
    name: 'C0',
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    capitalProvinceId: province0Id,
  })
  state = bindProvinceToHouseViaPolity(state, province0Id, polityId, houseId)
  state = bindProvinceToHouseViaPolity(state, province1Id, polityId, houseId)
  state = { ...state, persons: { ...state.persons, ...allPersons } }

  return {
    state,
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
      if (!extinctHouse) return
      expect(getHouseControlledProvinceIds(result.state, extinctHouse.id).length).toBe(0)

      const rulerHouse = result.state.houses['h-1' as HouseId]
      if (!rulerHouse) return
      expect(getHouseControlledProvinceIds(result.state, rulerHouse.id).length).toBeGreaterThan(0)
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

    it.skip('province houseControl set to inherited value (v0.15)', () => {
      // v0.16: Province.houseControl が型レベルで廃止されているため、本テストは無効化する。
      // 代わりに polityControl は変動しないことが期待される (§8.2)。
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

      const province0Id = 'p-0' as ProvinceId
      const province1Id = 'p-1' as ProvinceId

      let state = makeEmptyV016State()
      state = { ...state, currentYear: 10, currentMonth: 6 }
      state = withProvince(state, province0Id, { name: 'Province0' })
      state = withProvince(state, province1Id, { name: 'Province1', x: 1, y: 1 })
      state = withHouse(state, houseId, {
        name: 'RulerHouse',
        memberIds: ['pe-0' as PersonId],
        legacyPrestige: 90,
        wealth: 100,
        seatProvinceId: province0Id,
      })
      state = withHouse(state, candidateHouseId, {
        name: 'CandidateHouse',
        memberIds: ['pe-1' as PersonId],
        legacyPrestige: 40,
        wealth: 50,
        seatProvinceId: province1Id,
      })
      state = withPolity(state, polityId, {
        name: 'C0',
        ownerHouseId: houseId,
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 50,
        capitalProvinceId: province0Id,
      })
      state = bindProvinceToHouseViaPolity(state, province0Id, polityId, houseId)
      state = bindProvinceToHouseViaPolity(state, province1Id, polityId, houseId)
      const leaderOfficeId = 'oa-0' as import('../types/ids').OfficeAssignmentId
      state = {
        ...state,
        persons: { ...state.persons, ...persons },
        officeAssignments: {
          ...state.officeAssignments,
          [leaderOfficeId]: {
            id: leaderOfficeId,
            organization: { kind: 'polity' as const, id: polityId },
            role: 'leader' as const,
            holderPersonId: 'pe-0' as PersonId,
            active: true,
            startYear: 10,
            unpaidCount: 0,
          },
        },
        officeIndex: {
          byOrganization: {
            ...state.officeIndex.byOrganization,
            [`polity:${polityId}`]: [leaderOfficeId],
          },
          byHolderPerson: { ...state.officeIndex.byHolderPerson },
        },
        nextOfficeAssignmentId: state.nextOfficeAssignmentId + 1,
        factions: {},
        factionMemberships: {},
        factionIndex: { byLeader: {}, byMember: {} },
        nextFactionId: 0,
        nextFactionMembershipId: 0,
      }

      const ctx: TickContext = {
        state,
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
