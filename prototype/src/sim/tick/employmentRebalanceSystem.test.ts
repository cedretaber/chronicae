import { describe, expect, it } from 'vitest'
import { normalizePopEmploymentMut } from './employmentRebalanceSystem'
import {
  getHoldingClassCapacity,
  getHoldingEmployedPopSize,
  getHoldingPopsByClassAndEmployment,
} from '../selectors/popSelectors'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createProvinceId, createPopGroupId, createRealEstateAssetId } from '../types/ids'
import type { PopGroupId, ProductionRecipeId } from '../types/ids'
import type { PopGroup } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'

const PROVINCE = createProvinceId('p', 0)

describe('normalizePopEmploymentMut — demand-aware re-employment (B1)', () => {
  it('re-employs the shortage PopType first when capacity is scarce', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, PROVINCE)
    const holdingId = s.provinces[PROVINCE]!.holdingIds[0]!

    // farm asset → GRAIN_FIELD recipe demands peasants (lower) + freeholders (middle).
    const assetId = createRealEstateAssetId(0)
    const grainField = 'grain_field' as ProductionRecipeId
    const asset: RealEstateAsset = {
      id: assetId,
      holdingId,
      realEstateKind: 'farm',
      level: 1,
      createdWeek: 0,
      recipeSlots: { [grainField]: 20 },
    }

    // Two unemployed lower pops of equal size. laborers has the LOWER id (naive order would pick it
    // first); B1 must still employ peasants because the recipe creates peasants shortage.
    const laborers = createPopGroupId(100)
    const peasants = createPopGroupId(101)
    const mk = (id: PopGroupId, popType: 'laborers' | 'peasants'): PopGroup => ({
      id,
      holdingId,
      class: 'lower',
      popType,
      employed: false,
      size: 5000,
      wealth: 50,
      unrest: 10,
      attitudes: {},
    })

    const state: WorldState = {
      ...s,
      realEstateAssets: { [assetId]: asset },
      realEstateAssetIndex: {
        ...s.realEstateAssetIndex,
        byHolding: { ...s.realEstateAssetIndex.byHolding, [holdingId as string]: [assetId] },
      },
      popGroups: { [laborers]: mk(laborers, 'laborers'), [peasants]: mk(peasants, 'peasants') },
      popIndex: { byHolding: { [holdingId]: [laborers, peasants] } },
      nextPopGroupId: 1000,
    }

    const capacityLower = getHoldingClassCapacity(state, defaultConfig, holdingId, 'lower')
    expect(capacityLower).toBeGreaterThan(0)
    expect(capacityLower).toBeLessThan(5000) // room is scarce scarce vs each 5000-size pop

    normalizePopEmploymentMut(state, defaultConfig, holdingId)

    // capacity is filled, and entirely by the shortage type (peasants) — not laborers.
    expect(getHoldingEmployedPopSize(state, holdingId, 'lower')).toBeCloseTo(capacityLower)
    const employedLaborers = getHoldingPopsByClassAndEmployment(
      state,
      holdingId,
      'lower',
      true,
    ).filter((p) => p.popType === 'laborers')
    expect(employedLaborers.length).toBe(0)
    const employedPeasants = getHoldingPopsByClassAndEmployment(
      state,
      holdingId,
      'lower',
      true,
    ).filter((p) => p.popType === 'peasants')
    expect(employedPeasants.length).toBe(1)
  })
})
