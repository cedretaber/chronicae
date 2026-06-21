import { describe, expect, it } from 'vitest'
import { runPopMigrationSystem } from './popMigrationSystem'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import {
  getHoldingClassCapacity,
  getHoldingPopsByClassAndEmployment,
} from '../selectors/popSelectors'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createProvinceId, createPopGroupId, createRealEstateAssetId } from '../types/ids'
import type { PopGroupId, ProductionRecipeId, HoldingId, StateRegionId } from '../types/ids'
import type { PopGroup, PopType } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'

const PA = createProvinceId('p', 0)
const PB = createProvinceId('p', 1)
const GRAIN_FIELD = 'grain_field' as ProductionRecipeId

function mkPop(
  id: PopGroupId,
  holdingId: HoldingId,
  popType: PopType,
  employed: boolean,
  size: number,
  wealth: number,
): PopGroup {
  return {
    id,
    holdingId,
    class: 'lower',
    popType,
    employed,
    size,
    wealth,
    unrest: 10,
    attitudes: {},
  }
}

describe('PopMigrationSystem', () => {
  it('migrates from a crowded holding to a vacant one within the region, respecting caps', () => {
    let s = makeEmptyV016State()
    s = withProvince(s, PA)
    s = withProvince(s, PB)
    const hA = s.provinces[PA]!.holdingIds[0]! // crowded source
    const hB = s.provinces[PB]!.holdingIds[0]! // vacant target (has a farm → lower vacancy)

    // farm asset on hB → lower-stratum capacity / vacancy.
    const assetId = createRealEstateAssetId(0)
    const asset: RealEstateAsset = {
      id: assetId,
      holdingId: hB,
      realEstateKind: 'farm',
      level: 1,
      createdWeek: 0,
      recipeSlots: { [GRAIN_FIELD]: 20 },
    }

    const capA = getHoldingClassCapacity(s, defaultConfig, hA, 'lower')

    // hA: lower stratum fully employed (no local vacancy) + a large unemployed cohort (high pressure).
    const employedA = createPopGroupId(100)
    const migrant = createPopGroupId(101)
    // hB: a small resident pop so its inflow cap (∝ population) is > 0.
    const residentB = createPopGroupId(102)

    const state: WorldState = {
      ...s,
      realEstateAssets: { [assetId]: asset },
      realEstateAssetIndex: {
        ...s.realEstateAssetIndex,
        byHolding: { ...s.realEstateAssetIndex.byHolding, [hB as string]: [assetId] },
      },
      popGroups: {
        [employedA]: mkPop(employedA, hA, 'laborers', true, capA, 50),
        [migrant]: mkPop(migrant, hA, 'laborers', false, 1000, 5),
        [residentB]: mkPop(residentB, hB, 'peasants', true, 50, 50),
      },
      popIndex: { byHolding: { [hA]: [employedA, migrant], [hB]: [residentB] } },
      nextPopGroupId: 1000,
    }

    const inflowCapB = Math.min(
      50 * defaultConfig.popMigrationMaxInflowFractionPerHoldingPerMonth,
      defaultConfig.popMigrationMaxInflowPerHoldingPerMonthHardCap,
    )

    const ctx = createTickContext({ state, config: defaultConfig, rng: createRng('t') })
    const result = runPopMigrationSystem(ctx).state

    // migration occurred and stayed within the inflow cap of the (small) target holding.
    expect(result.monthlyPopMobility!.migratedTotal).toBeGreaterThan(0)
    expect(result.monthlyPopMobility!.migratedTotal).toBeLessThanOrEqual(inflowCapB + 1e-9)

    // a laborers cohort now lives in the target holding.
    const laborersInB = getHoldingPopsByClassAndEmployment(result, hB, 'lower', true).filter(
      (p) => p.popType === 'laborers',
    )
    expect(laborersInB.length).toBeGreaterThan(0)

    // byState records the intra-region flow on both sides (§8.12).
    const byState = result.monthlyPopMobility!.byState['sr-0' as StateRegionId]
    expect(byState?.migratedOut).toBeGreaterThan(0)
    expect(byState?.migratedIn).toBeGreaterThan(0)
  })
})
