import { describe, it, expect } from 'vitest'
import { runLandRevenueSystem } from './landRevenueSystem'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { createTickContext } from './context'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopGroup, PopClass } from '../types/popGroup'
import type { ProvinceId, PolityId, HouseId, PersonId, PopGroupId, HoldingId } from '../types/ids'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { appointHoldingBailiff, vacateHoldingBailiff } from '../mutations/provinceOfficeMutations'
import { defaultLandContractConfig } from '../config/landContractConfig'

function withPopGroup(
  state: WorldState,
  id: PopGroupId,
  provinceId: ProvinceId,
  popClass: PopClass,
  size: number,
  wealth: number,
): WorldState {
  const pop: PopGroup = {
    id,
    holdingId: 'hl-0' as HoldingId,
    class: popClass,
    occupation: 'agriculture',
    size,
    wealth,
    unrest: 0,
    attitudes: {},
  }
  const province = state.provinces[provinceId]
  if (!province) throw new Error(`withPopGroup: province ${provinceId} not found`)
  const holdingId = pop.holdingId
  const existingPopIds = state.popIndex.byHolding[holdingId] ?? []
  return {
    ...state,
    popGroups: { ...state.popGroups, [id]: pop },
    popIndex: {
      byHolding: {
        ...state.popIndex.byHolding,
        [holdingId]: [...existingPopIds, id],
      },
    },
  }
}

function makeCtx(state: WorldState): TickContext {
  return createTickContext({ state, config: defaultConfig, rng: createRng('test') })
}

function setupBaseWorld(): {
  state: WorldState
  polityId: PolityId
  houseId: HouseId
  provinceId: ProvinceId
  popId: PopGroupId
} {
  const polityId = 'dp-0' as PolityId
  const houseId = 'dh-0' as HouseId
  const provinceId = 'pr-0' as ProvinceId
  const popId = 'pg-0' as PopGroupId

  let state = makeEmptyV016State()
  state = withHouse(state, houseId, { seatProvinceId: provinceId })
  state = withProvince(state, provinceId, {})
  state = withPolity(state, polityId, {
    treasury: 0,
    capitalProvinceId: provinceId,
    ownerHouseId: houseId,
  })
  state = bindProvinceToHouseViaPolity(state, provinceId, polityId, houseId)
  state = withPopGroup(state, popId, provinceId, 'peasants', 100, 100)
  return { state, polityId, houseId, provinceId, popId }
}

describe('runLandRevenueSystem — bailiff salary path (v0.17.1)', () => {
  it('placeholder bailiff: 100% of retained goes to treasury', () => {
    const { state, polityId } = setupBaseWorld()
    const result = runLandRevenueSystem(makeCtx(state))
    const treasury = result.state.polities[polityId]!.treasury
    // production = 100 (size) * 1.0 (peasants productivity) * 1.0 (wealth/100) * 1.005 (dev modifier) * 1.0 (cc) = 100.5
    // grossTax = 100.5, retained at terminal = 100.5 (root taxRate=0)
    // bailiff is placeholder → 100% to treasury
    // treasury = 100.5 * taxEfficiency (1.0 default) * flowEfficiency
    const expected = 100.5 * defaultLandContractConfig.taxFlowEfficiency
    expect(treasury).toBeCloseTo(expected, 5)
  })

  it('normal bailiff: bailiffRevenueShare (10%) goes to bailiff.wealth, rest to treasury', () => {
    const { state: base, polityId, houseId, provinceId } = setupBaseWorld()
    // Promote bailiff to normal: replace placeholder with a real person
    const holdingId = base.provinces[provinceId]!.holdingIds[0]!
    let state = vacateHoldingBailiff(base, holdingId)
    const bailiffPersonId = 'pe-bailiff' as PersonId
    state = withPerson(state, bailiffPersonId, {
      houseId,
      age: 25,
      wealth: 0,
      kind: 'normal',
    })
    state = appointHoldingBailiff(state, {
      holdingId,
      holderPersonId: bailiffPersonId,
      appointingPolityId: polityId,
      week: state.absoluteWeek,
    }).state

    const result = runLandRevenueSystem(makeCtx(state))
    const bailiff = result.state.persons[bailiffPersonId]!
    const treasury = result.state.polities[polityId]!.treasury

    // production = 100.5, retained = 100.5, bailiff = 100.5 * 0.1 = 10.05, treasury raw = 90.45
    const expectedBailiff = 10.05
    const expectedTreasury = 90.45 * defaultLandContractConfig.taxFlowEfficiency
    expect(bailiff.wealth).toBeCloseTo(expectedBailiff, 5)
    expect(treasury).toBeCloseTo(expectedTreasury, 5)
  })

  it('production=0: bailiff and treasury both 0', () => {
    const { state: base, polityId, houseId, provinceId, popId } = setupBaseWorld()
    const holdingId = base.provinces[provinceId]!.holdingIds[0]!
    let state = vacateHoldingBailiff(base, holdingId)
    const bailiffPersonId = 'pe-bailiff' as PersonId
    state = withPerson(state, bailiffPersonId, {
      houseId,
      age: 25,
      wealth: 0,
      kind: 'normal',
    })
    state = appointHoldingBailiff(state, {
      holdingId,
      holderPersonId: bailiffPersonId,
      appointingPolityId: polityId,
      week: state.absoluteWeek,
    }).state
    // zero out pop wealth so production = 0
    state = {
      ...state,
      popGroups: {
        ...state.popGroups,
        [popId]: { ...state.popGroups[popId]!, wealth: 0 },
      },
    }

    const result = runLandRevenueSystem(makeCtx(state))
    expect(result.state.persons[bailiffPersonId]!.wealth).toBe(0)
    expect(result.state.polities[polityId]!.treasury).toBe(0)
  })

  it('dead bailiff (still appointed): no salary, 100% to treasury', () => {
    const { state: base, polityId, houseId, provinceId } = setupBaseWorld()
    const holdingId = base.provinces[provinceId]!.holdingIds[0]!
    let state = vacateHoldingBailiff(base, holdingId)
    const bailiffPersonId = 'pe-bailiff' as PersonId
    state = withPerson(state, bailiffPersonId, {
      houseId,
      age: 25,
      wealth: 0,
      kind: 'normal',
      alive: false,
    })
    state = appointHoldingBailiff(state, {
      holdingId,
      holderPersonId: bailiffPersonId,
      appointingPolityId: polityId,
      week: state.absoluteWeek,
    }).state

    const result = runLandRevenueSystem(makeCtx(state))
    const bailiff = result.state.persons[bailiffPersonId]!
    const treasury = result.state.polities[polityId]!.treasury
    expect(bailiff.wealth).toBe(0)
    // dead bailiff → no salary → treasury gets 100%
    const expectedTreasury = 100.5 * defaultLandContractConfig.taxFlowEfficiency
    expect(treasury).toBeCloseTo(expectedTreasury, 5)
  })
})
