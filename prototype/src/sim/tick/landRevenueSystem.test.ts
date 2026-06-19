import { describe, it, expect } from 'vitest'
import { runLandRevenueSystem } from './landRevenueSystem'
import { getHoldingProduction } from '../selectors/popEconomySelectors'
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
import {
  getBailiffLocalExtractionRate,
  getBailiffCollectionEfficiency,
  getBailiffFeeRate,
} from '../selectors/bailiffSelectors'
import { personAttitudeKey } from '../helpers/attitudeHelpers'

function withPopGroup(
  state: WorldState,
  id: PopGroupId,
  holdingId: HoldingId,
  popClass: PopClass,
  size: number,
  wealth: number,
  unrest: number = 0,
): WorldState {
  const pop: PopGroup = {
    id,
    holdingId,
    class: popClass,
    occupation: 'agriculture',
    size,
    wealth,
    unrest,
    attitudes: {},
  }
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
  holdingId: HoldingId
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
  const holdingId = state.provinces[provinceId]!.holdingIds[0]!
  state = withPopGroup(state, popId, holdingId, 'peasants', 100, 100)
  return { state, polityId, houseId, provinceId, holdingId, popId }
}

function setupWithNormalBailiff(): ReturnType<typeof setupBaseWorld> & {
  bailiffPersonId: PersonId
} {
  const base = setupBaseWorld()
  let state = vacateHoldingBailiff(base.state, base.holdingId)
  const bailiffPersonId = 'pe-bailiff' as PersonId
  state = withPerson(state, bailiffPersonId, {
    houseId: base.houseId,
    age: 25,
    wealth: 0,
    kind: 'normal',
  })
  state = appointHoldingBailiff(state, {
    holdingId: base.holdingId,
    holderPersonId: bailiffPersonId,
    appointingPolityId: base.polityId,
    week: state.absoluteWeek,
  }).state
  return { ...base, state, bailiffPersonId }
}

describe('runLandRevenueSystem — v0.25 extraction model', () => {
  it('placeholder bailiff: treasury receives remittanceToTerminal (after fee deduction)', () => {
    const { state, polityId, holdingId } = setupBaseWorld()
    const ctx = makeCtx(state)
    const result = runLandRevenueSystem(ctx)
    const treasury = result.state.polities[polityId]!.treasury

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const bailiffFeeRate = getBailiffFeeRate(state, ctx.config, assignmentId)
    const gross = getHoldingProduction(state, ctx.config, holdingId)
    const collected = gross * localExtractionRate * collectionEfficiency
    const remittance = collected * (1 - bailiffFeeRate)
    const expectedTreasury = remittance * defaultLandContractConfig.taxFlowEfficiency

    expect(treasury).toBeCloseTo(expectedTreasury, 3)
    expect(treasury).toBeLessThan(gross)
  })

  it('normal bailiff: fee goes to bailiff wealth, rest to treasury', () => {
    const { state, polityId, holdingId, bailiffPersonId } = setupWithNormalBailiff()
    const ctx = makeCtx(state)
    const result = runLandRevenueSystem(ctx)

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const bailiffFeeRate = getBailiffFeeRate(state, ctx.config, assignmentId)
    const gross = getHoldingProduction(state, ctx.config, holdingId)
    const collected = gross * localExtractionRate * collectionEfficiency
    const bailiffFee = collected * bailiffFeeRate
    const remittance = collected - bailiffFee

    const bailiff = result.state.persons[bailiffPersonId]!
    expect(bailiff.wealth).toBeCloseTo(bailiffFee, 3)
    expect(bailiff.wealth).toBeGreaterThan(0)

    const treasury = result.state.polities[polityId]!.treasury
    const expectedTreasury = remittance * defaultLandContractConfig.taxFlowEfficiency
    expect(treasury).toBeCloseTo(expectedTreasury, 3)
  })

  it('production=0: bailiff and treasury both 0', () => {
    const { state, polityId, bailiffPersonId, popId } = setupWithNormalBailiff()
    const zeroed = {
      ...state,
      popGroups: {
        ...state.popGroups,
        [popId]: { ...state.popGroups[popId]!, wealth: 0 },
      },
    }
    const result = runLandRevenueSystem(makeCtx(zeroed))
    expect(result.state.persons[bailiffPersonId]!.wealth).toBe(0)
    expect(result.state.polities[polityId]!.treasury).toBe(0)
  })

  it('dead bailiff: fallback, no fee, treasury gets full gross', () => {
    const { state: base, polityId, houseId, holdingId } = setupBaseWorld()
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
    expect(bailiff.wealth).toBe(0)
  })

  it('collectionFrictionBurdenRate damages POP wealth proportional to current wealth', () => {
    const { state, holdingId } = setupWithNormalBailiff()
    const ctx = makeCtx(state)
    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const frictionRate =
      localExtractionRate * (1 - collectionEfficiency) * ctx.config.collectionFrictionFactor
    const drainAt100 = frictionRate * ctx.config.localExtractionWealthPenalty * (100 / 100)
    const drainAt50 = frictionRate * ctx.config.localExtractionWealthPenalty * (50 / 100)
    expect(drainAt100).toBeGreaterThan(0)
    expect(drainAt50).toBeCloseTo(drainAt100 / 2, 5)
  })

  it('totalBurdenRate over comfort increases POP unrest', () => {
    const { state, popId } = setupWithNormalBailiff()
    const popBefore = state.popGroups[popId]!
    expect(popBefore.unrest).toBe(0)
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    expect(popAfter.unrest).toBeGreaterThan(0)
  })

  it('retainedToPop is based on provinceCollected, not gross', () => {
    const base = setupWithNormalBailiff()
    const popId = base.popId
    const newPopGroups = {
      ...base.state.popGroups,
      [popId]: { ...base.state.popGroups[popId]!, wealth: 50 },
    }
    const state = { ...base.state, popGroups: newPopGroups }
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    expect(popAfter.wealth).toBeGreaterThan(0)
    expect(popAfter.wealth).toBeLessThan(100)
  })

  it('POP→Bailiff attitude is set for normal bailiff', () => {
    const { state, popId, bailiffPersonId } = setupWithNormalBailiff()
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    const attKey = personAttitudeKey(bailiffPersonId)
    const attitude = popAfter.attitudes[attKey]
    expect(attitude).toBeDefined()
  })

  it('placeholder bailiff: no POP→Bailiff attitude update', () => {
    const { state, popId } = setupBaseWorld()
    const result = runLandRevenueSystem(makeCtx(state))
    const popAfter = result.state.popGroups[popId]!
    expect(Object.keys(popAfter.attitudes).length).toBe(0)
  })

  it('chain receives remittanceToTerminal, not grossHoldingRevenue', () => {
    const { state, polityId, holdingId } = setupWithNormalBailiff()
    const ctx = makeCtx(state)
    const result = runLandRevenueSystem(ctx)
    const treasury = result.state.polities[polityId]!.treasury

    const assignmentId = state.holdingOfficeIndex.byHolding[holdingId]!
    const localExtractionRate = getBailiffLocalExtractionRate(state, ctx.config, assignmentId)
    const collectionEfficiency = getBailiffCollectionEfficiency(
      state,
      ctx.config,
      assignmentId,
      'none',
    )
    const bailiffFeeRate = getBailiffFeeRate(state, ctx.config, assignmentId)
    const gross = getHoldingProduction(state, ctx.config, holdingId)
    const collected = gross * localExtractionRate * collectionEfficiency
    const remittance = collected * (1 - bailiffFeeRate)

    const expectedTreasury = remittance * defaultLandContractConfig.taxFlowEfficiency
    expect(treasury).toBeCloseTo(expectedTreasury, 3)
    expect(treasury).toBeLessThan(gross * defaultLandContractConfig.taxFlowEfficiency)
  })
})
