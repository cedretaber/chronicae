import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import type { PersonId, HouseId, CountryId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runPersonGrowthSystem } from './personGrowthSystem'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makeWorldState(
  person1Id: PersonId,
  house1Id: HouseId,
  country1Id: CountryId,
  opts?: { currentYear?: number; currentMonth?: number },
): WorldState {
  return {
    currentYear: opts?.currentYear ?? 1444,
    currentMonth: opts?.currentMonth ?? 1,
    provinces: {},
    countries: {
      [country1Id]: {
        id: country1Id,
        name: 'Country 1',
        houseIds: [house1Id],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 10,
        active: true,
        capitalProvinceId: '' as ProvinceId,
      },
    },
    houses: {
      [house1Id]: {
        id: house1Id,
        name: 'House 1',
        active: true,
        countryId: country1Id,
        provinceIds: [],
        memberIds: [person1Id],
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 0,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {},
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
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
    nextCountryIndex: 10,
  }
}

describe('runPersonGrowthSystem', () => {
  describe('non-January is no-op', () => {
    it('returns the same state object when currentMonth !== 1', () => {
      const person1Id = 'pe-0' as PersonId
      const house1Id = 'h-0' as HouseId
      const country1Id = 'c-0' as CountryId

      const state = makeWorldState(person1Id, house1Id, country1Id, {
        currentYear: 1444,
        currentMonth: 2,
      })
      state.persons = {
        [person1Id]: {
          id: person1Id,
          name: 'Person 1',
          sex: 'male' as const,
          age: 30,
          alive: true,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'legitimate' as const,
          abilities: { ...DEFAULT_ABILITIES, valor: 10 },
          aptitudes: { ...DEFAULT_ABILITIES, valor: 100 },
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
      }

      const ctx = makeCtx(state)
      const result = runPersonGrowthSystem(ctx)

      expect(result.state).toBe(state)
    })
  })

  describe('January triggers ability updates', () => {
    it('runs without error for a single person', () => {
      const person1Id = 'pe-0' as PersonId
      const house1Id = 'h-0' as HouseId
      const country1Id = 'c-0' as CountryId

      let currentCtx = makeCtx(
        makeWorldState(person1Id, house1Id, country1Id, {
          currentYear: 1444,
          currentMonth: 1,
        }),
      )
      currentCtx.state.persons = {
        [person1Id]: {
          id: person1Id,
          name: 'Person 1',
          sex: 'male' as const,
          age: 30,
          alive: true,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'legitimate' as const,
          abilities: { ...DEFAULT_ABILITIES, valor: 0 },
          aptitudes: { ...DEFAULT_ABILITIES, valor: 100 },
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
      }

      for (let i = 0; i < 10; i++) {
        currentCtx = runPersonGrowthSystem({
          ...currentCtx,
          state: {
            ...currentCtx.state,
            currentYear: 1444 + i,
          },
        })
      }

      const person = currentCtx.state.persons[person1Id]
      expect(person).toBeDefined()
      expect(person!.alive).toBe(true)
      expect(person!.abilities.valor).toBeGreaterThanOrEqual(0)
    })
  })

  describe('dead persons are skipped', () => {
    it('does not modify dead person abilities', () => {
      const alivePersonId = 'pe-0' as PersonId
      const deadPersonId = 'pe-1' as PersonId
      const house1Id = 'h-0' as HouseId
      const country1Id = 'c-0' as CountryId

      const state = makeWorldState(alivePersonId, house1Id, country1Id, {
        currentYear: 1444,
        currentMonth: 1,
      })

      const deadAbilitiesBefore = { ...DEFAULT_ABILITIES, valor: 10 }
      state.persons = {
        [alivePersonId]: {
          id: alivePersonId,
          name: 'Alive Person',
          sex: 'male' as const,
          age: 30,
          alive: true,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'legitimate' as const,
          abilities: { ...DEFAULT_ABILITIES, valor: 0 },
          aptitudes: { ...DEFAULT_ABILITIES, valor: 100 },
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
        [deadPersonId]: {
          id: deadPersonId,
          name: 'Dead Person',
          sex: 'male' as const,
          age: 30,
          alive: false,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'legitimate' as const,
          abilities: deadAbilitiesBefore,
          aptitudes: { ...DEFAULT_ABILITIES, valor: 100 },
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
      }

      const ctx = makeCtx(state)
      const result = runPersonGrowthSystem(ctx)

      const deadPerson = result.state.persons[deadPersonId]
      expect(deadPerson).toBeDefined()
      expect(deadPerson!.abilities).toEqual(deadAbilitiesBefore)
    })
  })

  describe('effectiveCeil caps at naturalCeil without experience', () => {
    it('prevents ability from exceeding naturalCeil when no relevant experience', () => {
      // valor uses 'youthPeak' (peakAge=30, maxFraction=0.75)
      // At age=30, naturalCeil = aptitude * 0.75 = 100 * 0.75 = 75
      // Without experience, effectiveCeil = naturalCeil = 75
      const person1Id = 'pe-0' as PersonId
      const house1Id = 'h-0' as HouseId
      const country1Id = 'c-0' as CountryId

      let currentCtx = makeCtx(
        makeWorldState(person1Id, house1Id, country1Id, {
          currentYear: 1444,
          currentMonth: 1,
        }),
      )
      currentCtx.state.persons = {
        [person1Id]: {
          id: person1Id,
          name: 'Person 1',
          sex: 'male' as const,
          age: 30,
          alive: true,
          houseId: house1Id,
          countryId: country1Id,
          childIds: [],
          birthStatus: 'legitimate' as const,
          abilities: { ...DEFAULT_ABILITIES, valor: 48 },
          aptitudes: { ...DEFAULT_ABILITIES, valor: 100 },
          traits: { ambition: 0.5, caution: 0.5 },
          legacyPrestige: 10,
          wealth: 0,
          attitudes: {},
        },
      }

      for (let i = 0; i < 100; i++) {
        currentCtx = runPersonGrowthSystem({
          ...currentCtx,
          state: {
            ...currentCtx.state,
            currentYear: 1444 + i,
          },
        })
      }

      const person = currentCtx.state.persons[person1Id]
      // ability must not exceed naturalCeil (75) since no relevant experience
      expect(person!.abilities.valor).toBeLessThanOrEqual(75)
      // ability must not exceed aptitude
      expect(person!.abilities.valor).toBeLessThanOrEqual(person!.aptitudes.valor)
    })
  })
})
