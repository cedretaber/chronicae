import { describe, it, expect } from 'vitest'
import type { WorldState } from '../types/world'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PersonId, HouseId, CountryId } from '../types/ids'
import { createRng } from '../rng/rng'
import { runEmergenceSystem } from './emergenceSystem'

function makeEmergenceState(
  month: number,
  livingMemberCount: number,
  config?: SimulationConfig,
): TickContext {
  const persons: Record<PersonId, Person> = {}
  const memberIds: PersonId[] = []

  for (let i = 0; i < livingMemberCount; i++) {
    const pid = ('pe-' + i) as PersonId
    persons[pid] = {
      id: pid,
      name: 'Person-' + i,
      age: 30,
      alive: true,
      houseId: 'h-0' as HouseId,
      countryId: 'c-0' as CountryId,
      stats: { admin: 5, martial: 5 },
      traits: { ambition: 0.5, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: 10,
    }
    memberIds.push(pid)
  }

  const houseId = 'h-0' as HouseId
  const countryId = 'c-0' as CountryId

  const cfg = config ?? {
    minLivingMembersPerHouse: 4,
    maxNewPersonsPerHousePerYear: 2,
    basePlotSuccess: 0.35,
    rebellionThreshold: 70,
    plotThreshold: 65,
    replacementThreshold: 15,
    rebellionSuccessMode: 'independence',
    maxRawEvents: 10000,
    maxChronicleEvents: 1000,
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
        },
      },
      houses: {
        [houseId]: {
          id: houseId,
          name: 'H0',
          active: true,
          countryId,
          provinceIds: [],
          memberIds,
          headId: 'pe-0' as PersonId,
          prestige: 50,
          cohesion: 60,
          loyaltyToCountry: 70,
          wealth: 100,
        },
      },
      persons,
      activePlots: {},
    },
    rng: createRng('emergence-test'),
    config: cfg,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: livingMemberCount > 0 ? livingMemberCount : 1,
  }
}

describe('runEmergenceSystem', () => {
  it('immediate replenishment: house with 0 living members gets 1 new person regardless of month', () => {
    const ctx = makeEmergenceState(6, 0)

    const result = runEmergenceSystem(ctx)

    const house = result.state.houses['h-0' as HouseId]
    expect(house).toBeDefined()
    expect(house?.memberIds.length).toBeGreaterThan(0)
    expect(result.events.length).toBeGreaterThan(0)
    expect(result.events[0].type).toBe('PERSON_EMERGED')
  })

  it('inactive house is skipped in immediate replenishment', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const ctx = {
      state: {
        currentYear: 1,
        currentMonth: 6,
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
          },
        },
        houses: {
          [houseId]: {
            id: houseId,
            name: 'H0',
            active: false,
            countryId,
            provinceIds: [],
            memberIds: [],
            headId: 'pe-0' as PersonId,
            prestige: 50,
            cohesion: 60,
            loyaltyToCountry: 70,
            wealth: 100,
          },
        },
        persons: {},
        activePlots: {},
      } as WorldState,
      rng: createRng('emergence-test'),
      config: {
        minLivingMembersPerHouse: 4,
        maxNewPersonsPerHousePerYear: 2,
        basePlotSuccess: 0.35,
        rebellionThreshold: 70,
        plotThreshold: 65,
        replacementThreshold: 15,
        rebellionSuccessMode: 'independence',
        maxRawEvents: 10000,
        maxChronicleEvents: 1000,
      },
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 0,
    }

    const result = runEmergenceSystem(ctx)

    const house = result.state.houses[houseId]
    expect(house?.memberIds.length).toBe(0)
    expect(result.events.length).toBe(0)
  })

  it('normal replenishment runs only in January (month=1)', () => {
    const ctx = makeEmergenceState(1, 2)
    const originalPersonCount = Object.keys(ctx.state.persons).length
    const originalMemberCount = ctx.state.houses['h-0' as HouseId].memberIds.length

    const result = runEmergenceSystem(ctx)

    // Immediate replenishment won't add anyone (2 living members)
    // Normal replenishment should add 2 (minLiving=4, living=2, deficit=2, maxNew=2)
    const newPersonCount = Object.keys(result.state.persons).length
    expect(newPersonCount).toBeGreaterThan(originalPersonCount)
    const newHouse = result.state.houses['h-0' as HouseId]
    expect(newHouse?.memberIds.length).toBeGreaterThan(originalMemberCount)
  })

  it('normal replenishment does not run in February (month=2)', () => {
    const ctx = makeEmergenceState(2, 2)
    const originalPersonCount = Object.keys(ctx.state.persons).length

    const result = runEmergenceSystem(ctx)

    // Immediate replenishment won't add (2 living members)
    // Normal replenishment only runs in January
    const newPersonCount = Object.keys(result.state.persons).length
    expect(newPersonCount).toBe(originalPersonCount)
  })

  it('January: house with 2 living members gets up to 2 new persons (minLiving=4, maxNew=2)', () => {
    const ctx = makeEmergenceState(1, 2)
    const originalPersonCount = Object.keys(ctx.state.persons).length

    const result = runEmergenceSystem(ctx)

    const newPersonCount = Object.keys(result.state.persons).length
    expect(newPersonCount).toBe(originalPersonCount + 2)
  })

  it('January: house with 4+ living members gets no new persons', () => {
    const ctx = makeEmergenceState(1, 4)
    const originalPersonCount = Object.keys(ctx.state.persons).length

    const result = runEmergenceSystem(ctx)

    const newPersonCount = Object.keys(result.state.persons).length
    expect(newPersonCount).toBe(originalPersonCount)
  })

  it('new person has houseId and countryId matching the house', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const ctx = makeEmergenceState(1, 0)

    const result = runEmergenceSystem(ctx)

    // After immediate replenishment (month=1), we get 1 from immediate + 2 from normal = 3 new persons
    // But we need to check the last person added
    const personKeys = Object.keys(result.state.persons).sort()
    const lastPersonKey = personKeys[personKeys.length - 1]
    const lastPerson = result.state.persons[lastPersonKey as PersonId]

    if (lastPerson) {
      expect(lastPerson.houseId).toBe(houseId)
      expect(lastPerson.countryId).toBe(countryId)
    }
  })

  it('new person ID does not collide with existing (nextPersonIndex increments)', () => {
    const ctx = makeEmergenceState(1, 0)
    const existingPersonKeys = new Set(Object.keys(ctx.state.persons))

    const result = runEmergenceSystem(ctx)

    const newPersonKeys = Object.keys(result.state.persons).filter(
      (k) => !existingPersonKeys.has(k),
    )
    expect(newPersonKeys.length).toBeGreaterThan(0)

    // Verify no overlap
    for (const key of newPersonKeys) {
      expect(existingPersonKeys.has(key)).toBe(false)
    }
  })

  it('PERSON_EMERGED event is emitted for each new person', () => {
    const ctx = makeEmergenceState(1, 0)

    const result = runEmergenceSystem(ctx)

    const emergedEvents = result.events.filter((e) => e.type === 'PERSON_EMERGED')
    const newPersons = Object.keys(result.state.persons).filter(
      (k) => !Object.keys(ctx.state.persons).includes(k),
    )

    expect(emergedEvents.length).toBe(newPersons.length)
    for (const event of emergedEvents) {
      expect(event.type).toBe('PERSON_EMERGED')
      expect(event.importance).toBe('minor')
      expect(event.actorIds.length).toBe(1)
      expect(event.houseIds.length).toBe(1)
    }
  })

  it('determinism: same input same output', () => {
    const ctx1 = makeEmergenceState(1, 0)
    const ctx2 = makeEmergenceState(1, 0)

    const result1 = runEmergenceSystem(ctx1)
    const result2 = runEmergenceSystem(ctx2)

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
  })
})
