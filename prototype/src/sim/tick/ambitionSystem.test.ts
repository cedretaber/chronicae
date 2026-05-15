import { describe, expect, it } from 'vitest'
import { createCountryId, createHouseId, createPersonId, createProvinceId } from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { calcAmbitionScores, runAmbitionSystem } from './ambitionSystem'

function makePerson(
  id: PersonId,
  ambition: number,
  loyaltyToCountry: number,
  caution: number,
): Person {
  return {
    id,
    name: 'Person-' + id,
    sex: 'male',
    age: 30,
    alive: true,
    houseId: 'h-0' as HouseId,
    countryId: 'c-0' as CountryId,
    childIds: [],
    birthStatus: 'unknown',
    stats: { admin: 5, martial: 5 },
    traits: { ambition, loyaltyToCountry, caution },
    prestige: 10,
  }
}

function makeFixture(): {
  ctx: TickContext
  state: WorldState
  houseId: HouseId
  countryId: CountryId
  headId: PersonId
  province1Id: ProvinceId
  province2Id: ProvinceId
} {
  const countryId = createCountryId('c', 0)
  const houseId = createHouseId('h', 0)
  const headId = createPersonId('pe', 0)
  const province1Id = createProvinceId('pr', 0)
  const province2Id = createProvinceId('pr', 1)

  const headPerson = makePerson(headId, 0.8, 0.3, 0.2)

  const state: WorldState = {
    currentYear: 1,
    currentMonth: 1,
    provinces: {
      [province1Id]: {
        id: province1Id,
        name: 'Province 1',
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
      },
      [province2Id]: {
        id: province2Id,
        name: 'Province 2',
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
        provinceIds: [province1Id, province2Id],
        memberIds: [headId],
        headId,
        cadetHouseIds: [],
        prestige: 40,
        cohesion: 60,
        loyaltyToCountry: 60,
        wealth: 100,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [headId]: headPerson,
    },
    activePlots: {},
    popGroups: {},
  }

  const ctx: TickContext = {
    state,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
  }

  return { ctx, state, houseId, countryId, headId, province1Id, province2Id }
}

describe('calcAmbitionScores', () => {
  it('returns correct rebellionTendency', () => {
    const { state, houseId } = makeFixture()

    const scores = calcAmbitionScores(state, houseId)

    // rebellionTendency =
    //   40 * 0.3          = 12
    //   + 2 * 4           = 8
    //   + 0.8 * 30        = 24
    //   + (100-70) * 0.3  = 9
    //   + (100-60) * 0.4  = 16
    //   + (1.0-0.3) * 30  = 21
    //   - 0.2 * 20        = -4
    //   - 50 * 0.2        = -10
    //   = 76
    expect(scores.rebellionTendency).toBeCloseTo(76, 5)
  })

  it('returns correct plotTendency', () => {
    const { state, houseId } = makeFixture()

    const scores = calcAmbitionScores(state, houseId)

    // plotTendency =
    //   0.8 * 30          = 24
    //   + 40 * 0.2        = 8
    //   + (100-60) * 0.3  = 12
    //   + (1.0-0.3) * 20  = 14
    //   - 0.2 * 15        = -3
    //   - 50 * 0.1        = -5
    //   = 50
    expect(scores.plotTendency).toBeCloseTo(50, 5)
  })

  it('returns zeros for unknown houseId', () => {
    const { state } = makeFixture()
    const unknownHouseId = createHouseId('h', 999)

    const scores = calcAmbitionScores(state, unknownHouseId)

    expect(scores.rebellionTendency).toBe(0)
    expect(scores.plotTendency).toBe(0)
  })
})

describe('runAmbitionSystem', () => {
  it('returns ctx unchanged', () => {
    const { ctx } = makeFixture()

    const result = runAmbitionSystem(ctx)

    expect(result).toBe(ctx)
  })
})
