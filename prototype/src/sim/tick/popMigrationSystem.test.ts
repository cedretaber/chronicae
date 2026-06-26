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
import {
  createProvinceId,
  createPopGroupId,
  createRealEstateAssetId,
  createHoldingImprovementId,
} from '../types/ids'
import type { PopGroupId, ProductionRecipeId, HoldingId, StateRegionId } from '../types/ids'
import type { PopGroup, PopType } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'
import type { WorkplaceRef } from '../types/workplaceRef'

const PA = createProvinceId('p', 0)
const PB = createProvinceId('p', 1)
const GRAIN_FIELD = 'grain_field' as ProductionRecipeId

function mkPop(
  id: PopGroupId,
  holdingId: HoldingId,
  popType: PopType,
  _employed: boolean, // v0.63: field removed; kept for call-site compat
  size: number,
  needSatisfaction: number, // v0.58: 旧 wealth 引数を needSatisfaction(移住圧の welfare 指標) へ転用。
): PopGroup {
  return {
    id,
    holdingId,
    class: 'lower',
    popType,
    employerId: null,
    size,
    money: 0,
    needSatisfaction,
    unrest: 10,
    attitudes: {},
  }
}

describe('PopMigrationSystem (v0.59 追補: per-source cap + 移動先非依存 + 失業着地)', () => {
  it('混雑 holding から空きのある holding へ移住する。cap は source rate・移動先非依存で失業着地 (Phase 3-4 再有効化)', () => {
    // v0.63 Phase 3-4: employedA に hA の manor_house (hi-0) を employer として設定し、
    //   hA の laborers 残余容量をゼロにする。hB は farm と manor_house 両方が空き → vacancy 大。
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

    // v0.63 Phase 3-4: employedA を hA の manor_house に紐付ける (hi-0 = withProvince(PA) が生成)。
    //   これにより getHoldingEmployedPopSizeByType(hA, 'laborers') = capA → remainingCapacity = 0。
    const hAEmployerRef: WorkplaceRef = { kind: 'improvement', id: createHoldingImprovementId(0) }

    const state: WorldState = {
      ...s,
      realEstateAssets: { [assetId]: asset },
      realEstateAssetIndex: {
        ...s.realEstateAssetIndex,
        byHolding: { ...s.realEstateAssetIndex.byHolding, [hB as string]: [assetId] },
      },
      popGroups: {
        [employedA]: {
          ...mkPop(employedA, hA, 'laborers', true, capA, 50),
          employerId: hAEmployerRef,
        },
        [migrant]: mkPop(migrant, hA, 'laborers', false, 1000, 5),
        [residentB]: mkPop(residentB, hB, 'peasants', true, 50, 50),
      },
      popIndex: { byHolding: { [hA]: [employedA, migrant], [hB]: [residentB] } },
      nextPopGroupId: 1000,
    }

    const ctx = createTickContext({ state, config: defaultConfig, rng: createRng('t') })
    const result = runPopMigrationSystem(ctx).state

    // v0.59 追補: cap は source サイズ依存 (size × stratum rate) で移動先非依存。
    //   旧 inflow cap (50×0.001=0.05) を大きく超え、source rate (1000×0.01=10) で頭打ちになる。
    const lowerMigRate = defaultConfig.popMigrationMonthlyRateByStratum.lower
    const moved = result.monthlyPopMobility!.migratedTotal
    expect(moved).toBeGreaterThan(1) // 旧 inflow cap (0.05) を大きく超える＝移動先非依存
    // per-source cap: 各 source は size × rate まで。region 内 source size 総和 × rate が上限。
    const totalSourceSize = capA + 1000 + 50
    expect(moved).toBeLessThanOrEqual(totalSourceSize * lowerMigRate + 1e-9)

    // a laborers cohort now lives in the target holding — 失業着地する (雇用は rebalance が確定)。
    const laborersInB = getHoldingPopsByClassAndEmployment(result, hB, 'lower', false).filter(
      (p) => p.popType === 'laborers',
    )
    expect(laborersInB.length).toBeGreaterThan(0)

    // byState records the intra-region flow on both sides (§8.12).
    const byState = result.monthlyPopMobility!.byState['sr-0' as StateRegionId]
    expect(byState?.migratedOut).toBeGreaterThan(0)
    expect(byState?.migratedIn).toBeGreaterThan(0)
  })

  it('v0.59: 移住を monthlyPopChange に流出元/流入先 holding 単位で累積する (Phase 3-4 再有効化)', () => {
    // v0.63 Phase 3-4: employedA に hA の manor_house (hi-0) を employer として設定。
    let s = makeEmptyV016State()
    s = withProvince(s, PA)
    s = withProvince(s, PB)
    const hA = s.provinces[PA]!.holdingIds[0]!
    const hB = s.provinces[PB]!.holdingIds[0]!

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
    const employedA = createPopGroupId(100)
    const migrant = createPopGroupId(101)
    const residentB = createPopGroupId(102)

    // v0.63 Phase 3-4: employedA を hA の manor_house に紐付ける (hi-0)。
    const hAEmployerRef: WorkplaceRef = { kind: 'improvement', id: createHoldingImprovementId(0) }

    const state: WorldState = {
      ...s,
      realEstateAssets: { [assetId]: asset },
      realEstateAssetIndex: {
        ...s.realEstateAssetIndex,
        byHolding: { ...s.realEstateAssetIndex.byHolding, [hB as string]: [assetId] },
      },
      popGroups: {
        [employedA]: {
          ...mkPop(employedA, hA, 'laborers', true, capA, 50),
          employerId: hAEmployerRef,
        },
        [migrant]: mkPop(migrant, hA, 'laborers', false, 1000, 5),
        [residentB]: mkPop(residentB, hB, 'peasants', true, 50, 50),
      },
      popIndex: { byHolding: { [hA]: [employedA, migrant], [hB]: [residentB] } },
      nextPopGroupId: 1000,
      // PopSystem が月初に生成する read-model を模す (migration は生成せず in-place 累積のみ)。
      monthlyPopChange: { week: 0, byHolding: {}, byPopGroupKey: {} },
    }

    const ctx = createTickContext({ state, config: defaultConfig, rng: createRng('t') })
    const result = runPopMigrationSystem(ctx).state

    const moved = result.monthlyPopMobility!.migratedTotal
    expect(moved).toBeGreaterThan(0)
    const change = result.monthlyPopChange!
    // 流出は source(hA)、流入は target(hB) に同量。
    expect(change.byHolding[hA]?.migrationOut).toBeCloseTo(moved)
    expect(change.byHolding[hB]?.migrationIn).toBeCloseTo(moved)
    expect(change.byHolding[hA]?.migrationIn ?? 0).toBe(0)
    expect(change.byHolding[hB]?.migrationOut ?? 0).toBe(0)
  })
})
