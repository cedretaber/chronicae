import { describe, expect, it } from 'vitest'
import { runPopJobChangeSystem } from './popJobChangeSystem'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import {
  getHoldingClassCapacity,
  getHoldingPopsByClassAndEmployment,
} from '../selectors/popSelectors'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createProvinceId, createPopGroupId, createRealEstateAssetId } from '../types/ids'
import type { PopGroupId, ProductionRecipeId, HoldingId } from '../types/ids'
import type { PopGroup, PopType, PopStratum } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'

const PROVINCE = createProvinceId('p', 0)
const GRAIN_FIELD = 'grain_field' as ProductionRecipeId // FARM_FIELD_LABOR: peasants (lower) + freeholders (middle)

// holding with one farm asset (grain field) and the given pops.
function setup(pops: Array<Omit<PopGroup, 'id' | 'holdingId' | 'attitudes'>>): {
  state: WorldState
  holdingId: HoldingId
} {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  const holdingId = s.provinces[PROVINCE]!.holdingIds[0]!
  const assetId = createRealEstateAssetId(0)
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind: 'farm',
    level: 1,
    createdWeek: 0,
    recipeSlots: { [GRAIN_FIELD]: 20 },
  }
  const popGroups: Record<PopGroupId, PopGroup> = {}
  const ids: PopGroupId[] = []
  pops.forEach((p, i) => {
    const id = createPopGroupId(100 + i)
    popGroups[id] = { ...p, id, holdingId, attitudes: {} }
    ids.push(id)
  })
  const state: WorldState = {
    ...s,
    realEstateAssets: { [assetId]: asset },
    realEstateAssetIndex: {
      ...s.realEstateAssetIndex,
      byHolding: { ...s.realEstateAssetIndex.byHolding, [holdingId as string]: [assetId] },
    },
    popGroups,
    popIndex: { byHolding: { [holdingId]: ids } },
    nextPopGroupId: 1000,
  }
  return { state, holdingId }
}

function run(state: WorldState): WorldState {
  const ctx = createTickContext({ state, config: defaultConfig, rng: createRng('t') })
  return runPopJobChangeSystem(ctx).state
}

function mk(
  cls: PopStratum,
  popType: PopType,
  employed: boolean,
  size: number,
  wealth: number,
): Omit<PopGroup, 'id' | 'holdingId' | 'attitudes'> {
  return { class: cls, popType, employed, size, wealth, unrest: 10 }
}

describe('PopJobChangeSystem', () => {
  it('C1: employed→employed lateral fires even when the stratum is at full capacity', () => {
    // farm wants peasants in the lower stratum, but the lower stratum is fully employed with laborers.
    const { state, holdingId } = setup([])
    const capLower = getHoldingClassCapacity(state, defaultConfig, holdingId, 'lower')
    expect(capLower).toBeGreaterThan(0)

    const lab = createPopGroupId(100)
    state.popGroups[lab] = {
      id: lab,
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employed: true,
      size: capLower, // fully fills lower capacity → zero remaining capacity
      wealth: 50,
      unrest: 10,
      attitudes: {},
    }
    state.popIndex.byHolding[holdingId] = [lab]

    const result = run(state)

    // lateral laborers→peasants must occur despite no remaining capacity (C1: same-stratum
    // employed→employed move does not increase headcount, so the capacity gate must not block it).
    const employedPeasants = getHoldingPopsByClassAndEmployment(
      result,
      holdingId,
      'lower',
      true,
    ).filter((p) => p.popType === 'peasants')
    expect(employedPeasants.length).toBeGreaterThan(0)
  })

  it('does not exceed the per-holding population-fraction cap', () => {
    const { state, holdingId } = setup([])
    const capLower = getHoldingClassCapacity(state, defaultConfig, holdingId, 'lower')
    const lab = createPopGroupId(100)
    state.popGroups[lab] = {
      id: lab,
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employed: true,
      size: capLower,
      wealth: 50,
      unrest: 10,
      attitudes: {},
    }
    state.popIndex.byHolding[holdingId] = [lab]

    const totalPop = capLower
    const expectedCap = Math.min(
      totalPop * defaultConfig.popJobChangeMaxFractionPerHoldingPerMonth,
      defaultConfig.popJobChangeMaxPerHoldingPerMonthHardCap,
    )

    const result = run(state)
    expect(result.monthlyPopMobility!.jobChangedTotal).toBeGreaterThan(0)
    expect(result.monthlyPopMobility!.jobChangedTotal).toBeLessThanOrEqual(expectedCap + 1e-9)
  })

  it('C3: promotion fires for the relatively-rich source, but not when wealth is uniform', () => {
    // Three unemployed peasants; the farm provides a middle-stratum freeholders shortage (promotion target).
    const spread = setup([
      mk('lower', 'peasants', false, 100, 10),
      mk('lower', 'peasants', false, 100, 50),
      mk('lower', 'peasants', false, 100, 90),
    ])
    const spreadResult = run(spread.state)
    const promotedSpread = getHoldingPopsByClassAndEmployment(
      spreadResult,
      spread.holdingId,
      'middle',
      true,
    ).filter((p) => p.popType === 'freeholders')
    expect(promotedSpread.length).toBeGreaterThan(0) // the wealth-90 peasant clears p75 + median gate

    const flat = setup([
      mk('lower', 'peasants', false, 100, 50),
      mk('lower', 'peasants', false, 100, 50),
      mk('lower', 'peasants', false, 100, 50),
    ])
    const flatResult = run(flat.state)
    const promotedFlat = getHoldingPopsByClassAndEmployment(
      flatResult,
      flat.holdingId,
      'middle',
      true,
    ).filter((p) => p.popType === 'freeholders')
    expect(promotedFlat.length).toBe(0) // collapsed distribution → no one clears the relative gate
  })
})
