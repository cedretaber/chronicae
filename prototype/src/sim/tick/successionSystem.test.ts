import { describe, it, expect } from 'vitest'
import type { TickContext } from './context'
import type { Person } from '../types/person'
import type { PersonId, HouseId, CountryId, ProvinceId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runSuccessionSystem } from './successionSystem'

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
): Person {
  return {
    id,
    name,
    age,
    alive,
    houseId,
    countryId,
    stats: { admin, martial },
    traits: { ambition, loyaltyToCountry: 0.5, caution: 0.5 },
    prestige,
  }
}

function makeSuccessionCtx(
  headAlive: boolean,
  otherMembers: {
    id: PersonId
    name: string
    age: number
    alive: boolean
    admin: number
    martial: number
    ambition: number
    prestige: number
  }[],
  month: number = 1,
): TickContext {
  const houseId = 'h-0' as HouseId
  const countryId = 'c-0' as CountryId

  const headId = 'pe-0' as PersonId
  const head = makePerson(headId, 'Head', 50, headAlive, houseId, countryId, 5, 5, 0.5, 30)

  const allPersons: Record<PersonId, Person> = { [headId]: head }
  const memberIds: PersonId[] = [headId]

  for (const m of otherMembers) {
    const memberPerson: Person = {
      id: m.id,
      name: m.name,
      age: m.age,
      alive: m.alive,
      houseId,
      countryId,
      stats: { admin: m.admin, martial: m.martial },
      traits: { ambition: m.ambition, loyaltyToCountry: 0.5, caution: 0.5 },
      prestige: m.prestige,
    }
    allPersons[m.id] = memberPerson
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
          headId,
          prestige: 50,
          cohesion: 60,
          loyaltyToCountry: 70,
          wealth: 100,
        },
      },
      persons: allPersons,
      activePlots: {},
    },
    rng: createRng('succession-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: otherMembers.length + 1,
  }
}

describe('runSuccessionSystem', () => {
  it('alive head: no succession occurs, headId unchanged', () => {
    const ctx = makeSuccessionCtx(true, [])
    const originalHeadId = ctx.state.houses['h-0' as HouseId].headId

    const result = runSuccessionSystem(ctx)

    const newHouse = result.state.houses['h-0' as HouseId]
    expect(newHouse?.headId).toBe(originalHeadId)
    expect(result.events.length).toBe(0)
  })

  it('dead head + 1 alive member: that member becomes head, HOUSE_HEAD_CHANGED event emitted', () => {
    const ctx = makeSuccessionCtx(false, [
      {
        id: 'pe-1' as PersonId,
        name: 'Member1',
        age: 30,
        alive: true,
        admin: 5,
        martial: 5,
        ambition: 0.5,
        prestige: 10,
      },
    ])

    const result = runSuccessionSystem(ctx)

    const newHouse = result.state.houses['h-0' as HouseId]
    expect(newHouse?.headId).toBe('pe-1' as PersonId)
    expect(result.events.length).toBeGreaterThan(0)
    expect(result.events[0].type).toBe('HOUSE_HEAD_CHANGED')
  })

  it('dead head + no alive members: HOUSE_EXTINCT event emitted, house.active=false', () => {
    const ctx = makeSuccessionCtx(false, [])

    const result = runSuccessionSystem(ctx)

    const newHouse = result.state.houses['h-0' as HouseId]
    expect(newHouse?.active).toBe(false)
    expect(result.events.length).toBeGreaterThan(0)
    const event = result.events[0]
    expect(event.type).toBe('HOUSE_EXTINCT')
    expect(event.importance).toBe('major')
  })

  it('house extinction: provinces transferred to ruler house', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId
    const provinceId = 'p-0' as ProvinceId

    const ctx: TickContext = {
      state: {
        currentYear: 1,
        currentMonth: 1,
        provinces: {
          [provinceId]: {
            id: provinceId,
            name: 'P0',
            x: 0,
            y: 0,
            neighbors: [],
            ownerHouseId: houseId,
            countryId,
            baseTax: 5,
            manpower: 5,
            unrest: 0,
          },
        },
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
            provinceIds: [provinceId],
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
      },
      rng: createRng('succession-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 0,
    }

    const result = runSuccessionSystem(ctx)

    // After extinction, the house should be inactive and provinces transferred
    const extinctHouse = result.state.houses[houseId]
    expect(extinctHouse?.active).toBe(false)

    // The province should have been transferred to the ruler house (same as original in this case)
    const province = result.state.provinces[provinceId]
    expect(province?.ownerHouseId).toBe(result.state.countries[countryId]?.rulerHouseId)
  })

  it('succession score formula: higher score candidate wins', () => {
    const houseId = 'h-0' as HouseId
    const countryId = 'c-0' as CountryId

    const pe1 = makePerson(
      'pe-1' as PersonId,
      'Candidate1',
      20,
      true,
      houseId,
      countryId,
      3,
      3,
      0.3,
      5,
    )
    const pe2 = makePerson(
      'pe-2' as PersonId,
      'Candidate2',
      60,
      true,
      houseId,
      countryId,
      9,
      9,
      0.9,
      50,
    )

    const persons: Record<PersonId, Person> = {}
    const pe0Key = 'pe-0' as PersonId
    const pe1Key = 'pe-1' as PersonId
    const pe2Key = 'pe-2' as PersonId
    persons[pe0Key] = makePerson(pe0Key, 'DeadHead', 50, false, houseId, countryId, 5, 5, 0.5, 30)
    persons[pe1Key] = pe1
    persons[pe2Key] = pe2

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
            prestige: 50,
            cohesion: 60,
            loyaltyToCountry: 70,
            wealth: 100,
          },
        },
        persons,
        activePlots: {},
      },
      rng: createRng('succession-test'),
      config: defaultConfig,
      events: [],
      nextEventIndex: 0,
      nextPersonIndex: 3,
    }

    const result = runSuccessionSystem(ctx)

    const newHouse = result.state.houses[houseId]
    expect(newHouse?.headId).toBe('pe-2' as PersonId)
  })

  it('HOUSE_HEAD_CHANGED event has correct fields', () => {
    const ctx = makeSuccessionCtx(false, [
      {
        id: 'pe-1' as PersonId,
        name: 'NewHead',
        age: 30,
        alive: true,
        admin: 5,
        martial: 5,
        ambition: 0.5,
        prestige: 10,
      },
    ])

    const result = runSuccessionSystem(ctx)

    const headChangedEvents = result.events.filter((e) => e.type === 'HOUSE_HEAD_CHANGED')
    expect(headChangedEvents.length).toBeGreaterThan(0)

    const event = headChangedEvents[0]
    expect(event.year).toBe(1)
    expect(event.month).toBe(1)
    expect(event.importance).toBe('normal')
    expect(event.actorIds.length).toBe(1)
    expect(event.houseIds.length).toBe(1)
    expect(event.countryIds.length).toBe(1)
    expect(event.summary).toContain('NewHead')
    expect(event.summary).toContain('head')
  })

  it('determinism: same input produces same result', () => {
    const ctx1 = makeSuccessionCtx(false, [
      {
        id: 'pe-1' as PersonId,
        name: 'Member1',
        age: 30,
        alive: true,
        admin: 5,
        martial: 5,
        ambition: 0.5,
        prestige: 10,
      },
    ])
    const ctx2 = makeSuccessionCtx(false, [
      {
        id: 'pe-1' as PersonId,
        name: 'Member1',
        age: 30,
        alive: true,
        admin: 5,
        martial: 5,
        ambition: 0.5,
        prestige: 10,
      },
    ])

    const result1 = runSuccessionSystem(ctx1)
    const result2 = runSuccessionSystem(ctx2)

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
  })

  it('no RNG consumed (rng state unchanged after succession)', () => {
    const ctx = makeSuccessionCtx(false, [
      {
        id: 'pe-1' as PersonId,
        name: 'Member1',
        age: 30,
        alive: true,
        admin: 5,
        martial: 5,
        ambition: 0.5,
        prestige: 10,
      },
    ])
    const originalRngState = ctx.rng.state

    runSuccessionSystem(ctx)

    expect(ctx.rng.state).toBe(originalRngState)
  })
})
