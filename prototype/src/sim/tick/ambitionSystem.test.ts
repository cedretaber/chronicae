import { describe, expect, it } from 'vitest'
import {
  createPolityId,
  createHouseId,
  createOfficeAssignmentId,
  createPersonId,
  createProvinceId,
} from '../types/ids'
import type { PolityId, HouseId, PersonId, ProvinceId } from '../types/ids'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { calcAmbitionScores, runAmbitionSystem } from './ambitionSystem'
import {
  bindProvinceToHouseViaPolity,
  makeEmptyV016State,
  withHouse,
  withPerson,
  withPolity,
  withProvince,
} from '../testFixtures'

function makeFixture(): {
  ctx: TickContext
  state: WorldState
  houseId: HouseId
  polityId: PolityId
  headId: PersonId
  province1Id: ProvinceId
  province2Id: ProvinceId
} {
  const polityId = createPolityId('c', 0)
  const houseId = createHouseId('h', 0)
  const headId = createPersonId('pe', 0)
  const province1Id = createProvinceId('pr', 0)
  const province2Id = createProvinceId('pr', 1)

  let state = makeEmptyV016State()
  state = withProvince(state, province1Id, { name: 'Province 1' })
  state = withProvince(state, province2Id, { name: 'Province 2' })
  state = withHouse(state, houseId, {
    name: 'H0',
    memberIds: [headId],
    legacyPrestige: 50,
    wealth: 100,
    seatProvinceId: province1Id,
  })
  state = withPolity(state, polityId, {
    name: 'C0',
    ownerHouseId: houseId,
    treasury: 100,
    legacyPrestige: 50,
    adminPower: 50,
    capitalProvinceId: province1Id,
  })
  state = bindProvinceToHouseViaPolity(state, province1Id, polityId, houseId)
  state = bindProvinceToHouseViaPolity(state, province2Id, polityId, houseId)
  state = withPerson(state, headId, {
    name: 'Person-' + headId,
    houseId,
    birthStatus: 'unknown',
    traits: { ambition: 0.8, caution: 0.2 },
    legacyPrestige: 10,
  })

  const officeId = createOfficeAssignmentId(0)
  const stateWithLeader: WorldState = {
    ...state,
    officeAssignments: {
      ...state.officeAssignments,
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
      byOrganization: {
        ...state.officeIndex.byOrganization,
        [`house:${houseId as string}`]: [officeId],
      },
      byHolderPerson: {
        ...state.officeIndex.byHolderPerson,
        [headId as string]: [officeId],
      },
    },
    nextOfficeAssignmentId: state.nextOfficeAssignmentId + 1,
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
    nextPolityIndex: 0,
  }

  return { ctx, state: stateWithLeader, houseId, polityId, headId, province1Id, province2Id }
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
    //   + (1.0-0.5) * 30    = 15   (1 - headPolityLoyalty=0.5, derived from neutral attitudes)
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
    //   + (1.0-0.5) * 20    = 10   (1 - headPolityLoyalty=0.5, neutral attitudes)
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
