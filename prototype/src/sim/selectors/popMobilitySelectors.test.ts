import { describe, expect, it } from 'vitest'
import { computeHoldingPopTypeDemand, computeStratumWealthQuantiles } from './popMobilitySelectors'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createProvinceId, createPopGroupId, createRealEstateAssetId } from '../types/ids'
import type { HoldingId, StateRegionId, ProductionRecipeId, PopGroupId } from '../types/ids'
import type { PopGroup, PopType, PopStratum } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'

const PROVINCE = createProvinceId('p', 0)

type PopSpec = {
  cls: PopStratum
  popType: PopType
  wealth: number
  size: number
  employed?: boolean
}

// withProvince auto-creates one holding linked to sr-0; we attach pops to it.
function setupPops(specs: PopSpec[]): { state: WorldState; holdingId: HoldingId } {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  const holdingId = s.provinces[PROVINCE]!.holdingIds[0]!
  const popGroups: Record<PopGroupId, PopGroup> = {}
  const ids: PopGroupId[] = []
  specs.forEach((spec, i) => {
    const id = createPopGroupId(100 + i)
    popGroups[id] = {
      id,
      holdingId,
      class: spec.cls,
      popType: spec.popType,
      employed: spec.employed ?? true,
      size: spec.size,
      wealth: spec.wealth,
      unrest: 10,
      attitudes: {},
    }
    ids.push(id)
  })
  const state: WorldState = {
    ...s,
    popGroups,
    popIndex: { byHolding: { [holdingId]: ids } },
    nextPopGroupId: 1000,
  }
  return { state, holdingId }
}

describe('computeStratumWealthQuantiles', () => {
  it('computes size-weighted wealth quantiles per stratum within a state region', () => {
    // lower stratum: half poor (wealth 10), half rich (wealth 90), equal size.
    const { state } = setupPops([
      { cls: 'lower', popType: 'laborers', wealth: 10, size: 50 },
      { cls: 'lower', popType: 'artisans', wealth: 90, size: 50 },
    ])

    const q = computeStratumWealthQuantiles(state, 'sr-0' as StateRegionId)

    // cumulative size weighting: p25 & median fall in the wealth-10 cohort, p75 in the wealth-90 cohort.
    expect(q.lower?.p25).toBe(10)
    expect(q.lower?.median).toBe(10)
    expect(q.lower?.p75).toBe(90)
    expect(q.middle).toBeUndefined() // no middle-stratum pops
    expect(q.upper).toBeUndefined()
  })
})

describe('computeHoldingPopTypeDemand', () => {
  it('falls back to current composition when the holding has no recipe demand', () => {
    const { state, holdingId } = setupPops([
      { cls: 'lower', popType: 'laborers', wealth: 50, size: 30 },
      { cls: 'lower', popType: 'peasants', wealth: 50, size: 10 },
    ])

    const d = computeHoldingPopTypeDemand(state, defaultConfig, holdingId)

    expect(d.currentEmployedByType.laborers).toBe(30)
    expect(d.currentEmployedByType.peasants).toBe(10)
    // no recipe-bearing asset → idealShare mirrors current lower composition (0.75 / 0.25).
    expect(d.idealShareByType.laborers).toBeCloseTo(0.75)
    expect(d.idealShareByType.peasants).toBeCloseTo(0.25)
  })

  it('derives idealShare and shortage from recipeSlots', () => {
    const { state, holdingId } = setupPops([]) // no employed pops
    const assetId = createRealEstateAssetId(0)
    const grainField = 'grain_field' as ProductionRecipeId // GRAIN_FIELD -> FARM_FIELD_LABOR (peasants:3, freeholders:1)
    const asset: RealEstateAsset = {
      id: assetId,
      holdingId,
      realEstateKind: 'farm',
      level: 1,
      createdWeek: 0,
      recipeSlots: { [grainField]: 20 },
    }
    state.realEstateAssets[assetId] = asset
    state.realEstateAssetIndex.byHolding[holdingId as string] = [assetId]

    const d = computeHoldingPopTypeDemand(state, defaultConfig, holdingId)

    // Within lower stratum only peasants is demanded; within middle only freeholders.
    expect(d.idealShareByType.peasants).toBeCloseTo(1)
    expect(d.idealShareByType.freeholders).toBeCloseTo(1)
    expect(d.idealShareByType.laborers ?? 0).toBe(0)
    // farm provides lower-stratum capacity; with zero employed peasants, shortage == desired > 0.
    expect(d.desiredEmployedByType.peasants!).toBeGreaterThan(0)
    expect(d.shortageByType.peasants).toBeCloseTo(d.desiredEmployedByType.peasants!)
  })
})
