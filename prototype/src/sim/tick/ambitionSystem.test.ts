import { describe, expect, it } from 'vitest'
import {
  createCountryId,
  createHouseId,
  createOfficeAssignmentId,
  createPersonId,
  createProvinceId,
} from '../types/ids'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { Person } from '../types/person'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { calcAmbitionScores, runAmbitionSystem } from './ambitionSystem'

const DEFAULT_ABILITIES = {
  valor: 50,
  command: 50,
  numeracy: 50,
  learning: 50,
  charisma: 50,
  insight: 50,
}

function makePerson(id: PersonId, ambition: number, caution: number): Person {
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
    abilities: DEFAULT_ABILITIES,
    aptitudes: DEFAULT_ABILITIES,
    traits: { ambition, caution },
    legacyPrestige: 10,
    wealth: 0,
    attitudes: {},
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

  const headPerson = makePerson(headId, 0.8, 0.2)

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
        houseIds: [houseId],
        treasury: 100,
        legacyPrestige: 50,
        adminPower: 50,
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
        cadetHouseIds: [],
        legacyPrestige: 50,
        wealth: 100,
        seatProvinceId: '' as ProvinceId,
      },
    },
    persons: {
      [headId]: headPerson,
    },
    activePlots: {},
    popGroups: {},
    organizationShares: {},
    officeAssignments: {},
    shareIndex: { byOrganization: {}, byHolder: {} },
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  }

  const officeId = createOfficeAssignmentId(0)
  const stateWithLeader: WorldState = {
    ...state,
    officeAssignments: {
      [officeId]: {
        id: officeId,
        organization: { kind: 'house', id: houseId },
        role: 'leader',
        holderPersonId: headId,
        active: true,
        startYear: 1,
        unpaidCount: 0,
      },
    },
    officeIndex: {
      byOrganization: { [`house:${houseId as string}`]: [officeId] },
      byHolderPerson: { [headId as string]: [officeId] },
    },
    nextOfficeAssignmentId: 1,
  }

  const ctx: TickContext = {
    state: stateWithLeader,
    rng: createRng('test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextCountryIndex: 0,
  }

  return { ctx, state: stateWithLeader, houseId, countryId, headId, province1Id, province2Id }
}

describe('calcAmbitionScores', () => {
  it('returns correct rebellionTendency', () => {
    const { state, houseId } = makeFixture()

    const scores = calcAmbitionScores(state, houseId)

    // rebellionTendency =
    //   50 * 0.3            = 15   (house.legacyPrestige)
    //   + 2 * 4             = 8    (2 provinces)
    //   + 0.8 * 30          = 24   (ambition)
    //   + (100-50) * 0.3    = 15   (100 - legitimacy=50, derived from neutral attitudes)
    //   + (100-50) * 0.4    = 20   (100 - houseLoyalty=50, derived from neutral attitudes)
    //   + (1.0-0.5) * 30    = 15   (1 - headCountryLoyalty=0.5, derived from neutral attitudes)
    //   - 0.2 * 20          = -4   (caution)
    //   - 50 * 0.2          = -10  (adminPower)
    //   = 83
    expect(scores.rebellionTendency).toBeCloseTo(83, 5)
  })

  it('returns correct plotTendency', () => {
    const { state, houseId } = makeFixture()

    const scores = calcAmbitionScores(state, houseId)

    // plotTendency =
    //   0.8 * 30            = 24   (ambition)
    //   + 50 * 0.2          = 10   (house.legacyPrestige)
    //   + (100-50) * 0.3    = 15   (100 - houseLoyalty=50, derived from neutral attitudes)
    //   + (1.0-0.5) * 20    = 10   (1 - headCountryLoyalty=0.5, neutral attitudes)
    //   - 0.2 * 15          = -3   (caution)
    //   - 50 * 0.1          = -5   (adminPower)
    //   = 51
    expect(scores.plotTendency).toBeCloseTo(51, 5)
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
