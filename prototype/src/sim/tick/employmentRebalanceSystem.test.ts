import { describe, expect, it } from 'vitest'
import { normalizePopEmploymentMut } from './employmentRebalanceSystem'
import {
  getHoldingPopTypeCapacity,
  getHoldingEmployedPopSizeByType,
  getWorkplaceEmployedPopSizeByType,
} from '../selectors/popSelectors'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createProvinceId, createPopGroupId, createRealEstateAssetId } from '../types/ids'
import type { HoldingId, PopGroupId } from '../types/ids'
import type { PopGroup, PopType } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'
import { workplaceRefKey } from '../types/workplaceRef'

const PROVINCE = createProvinceId('p', 0)

// 共通セットアップ: farm asset を 1 つ持つ manor holding (withProvince が manor_house も付与)。
function setupFarmHolding(pops: { popType: PopType; size: number }[]): {
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
    recipeSlots: {},
  }
  const popGroups: Record<PopGroupId, PopGroup> = {}
  const ids: PopGroupId[] = []
  pops.forEach((p, i) => {
    const id = createPopGroupId(100 + i)
    popGroups[id] = {
      id,
      holdingId,
      class: getPopStratum(p.popType),
      popType: p.popType,
      employerId: null,
      size: p.size,
      money: 0,
      needSatisfaction: 50,
      unrest: 10,
      attitudes: {},
    }
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

// v0.57 §雇用細分化: 施設駆動の PopType ハード枠を検証する。
describe('normalizePopEmploymentMut — PopType ハード枠', () => {
  it('各 PopType を独立した容量上限まで雇用する (枠の競合なし)', () => {
    // 大量の未就業 peasants と laborers。peasants は farm 由来枠、laborers は manor_house 由来枠。
    const { state, holdingId } = setupFarmHolding([
      { popType: 'peasants', size: 100000 },
      { popType: 'laborers', size: 100000 },
    ])

    const capPeasants = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'peasants')
    const capLaborers = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'laborers')
    expect(capPeasants).toBeGreaterThan(0)
    expect(capLaborers).toBeGreaterThan(0)

    normalizePopEmploymentMut(state, defaultConfig, holdingId)

    // Phase 3-4: employer 紐付け済み。各 PopType は対応 employer の capacity まで雇用される。
    expect(getHoldingEmployedPopSizeByType(state, holdingId, 'peasants')).toBeCloseTo(
      capPeasants,
      0,
    )
    expect(getHoldingEmployedPopSizeByType(state, holdingId, 'laborers')).toBeCloseTo(
      capLaborers,
      0,
    )
  })

  it('熟練職 (自作農) は主要職能 (小作農) の実雇用数までしか雇えない (同数上限)', () => {
    // 小作農を少量 (容量内) ・自作農を大量。自作農枠は十分あるが小作農の実数で頭打ちになる。
    // v0.59: landQuality 廃止で実容量は base のみ (level1 farm: peasants 45.5 / freeholders 19.5)。
    //   小作農 15 < freeholders 容量 なので「同数上限」が freeholders を縛る (容量ではなく)。
    const PEASANT_COUNT = 15
    const { state, holdingId } = setupFarmHolding([
      { popType: 'peasants', size: PEASANT_COUNT },
      { popType: 'freeholders', size: 100000 },
    ])

    const capPeasants = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'peasants')
    const capFreeholders = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'freeholders')
    // 前提: 小作農容量は実数 (15) より大きく全員就業でき、自作農容量も 15 より大きい (上限が同数で効く)。
    expect(capPeasants).toBeGreaterThan(PEASANT_COUNT)
    expect(capFreeholders).toBeGreaterThan(PEASANT_COUNT)

    normalizePopEmploymentMut(state, defaultConfig, holdingId)

    // Phase 3-4: employer 紐付け済み。小作農は全員雇用、自作農は小作農実数 (15) でキャップ。
    const employedPeasants = getHoldingEmployedPopSizeByType(state, holdingId, 'peasants')
    const employedFreeholders = getHoldingEmployedPopSizeByType(state, holdingId, 'freeholders')
    expect(employedPeasants).toBe(PEASANT_COUNT)
    // 同数上限: 自作農は小作農の実雇用数 (15) でキャップされる。
    expect(employedFreeholders).toBe(PEASANT_COUNT)
  })
})

// v0.63 Task 4: per-employer WorkplaceRef 紐付けの動作検証。
describe('normalizePopEmploymentMut — WorkplaceRef 紐付け (v0.63 Task 4)', () => {
  it('消失した employer を参照する POP は Phase 1 で強制失業させる', () => {
    // farm holding に laborers を配置し、存在しない asset ref を直接セットする。
    // normalize 後: 消失 employer を参照する POP は存在しない。
    const { state, holdingId } = setupFarmHolding([{ popType: 'laborers', size: 500 }])
    const popId = createPopGroupId(100) // setupFarmHolding が 100 から採番

    const vanishedRef = { kind: 'asset' as const, id: createRealEstateAssetId(99) }
    const ws: WorldState = {
      ...state,
      popGroups: {
        ...state.popGroups,
        [popId]: { ...state.popGroups[popId]!, employerId: vanishedRef },
      },
    }

    normalizePopEmploymentMut(ws, defaultConfig, holdingId)

    // 消失した employer を参照する POP は存在しない
    const vanishedKey = workplaceRefKey(vanishedRef)
    const hasVanishedPop = Object.values(ws.popGroups).some(
      (p) =>
        p.holdingId === holdingId &&
        p.employerId !== null &&
        workplaceRefKey(p.employerId) === vanishedKey,
    )
    expect(hasVanishedPop).toBe(false)

    // POP 総量は保存されている
    const total = Object.values(ws.popGroups)
      .filter((p) => p.holdingId === holdingId)
      .reduce((sum, p) => sum + p.size, 0)
    expect(total).toBeCloseTo(500)
  })

  it('Phase 2 で失業 POP を具体的な WorkplaceRef (employer) に紐付ける', () => {
    // 大量の未就業 peasants。normalize 後: farm ref に紐付けられた peasants が capacity 分存在する。
    const { state, holdingId } = setupFarmHolding([{ popType: 'peasants', size: 100000 }])
    const assetId = createRealEstateAssetId(0)
    const farmRef = { kind: 'asset' as const, id: assetId }

    const capPeasants = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'peasants')
    normalizePopEmploymentMut(state, defaultConfig, holdingId)

    // 雇用済み総量 = capacity (holding-level)
    expect(getHoldingEmployedPopSizeByType(state, holdingId, 'peasants')).toBeCloseTo(
      capPeasants,
      0,
    )
    // farm ref に具体的に紐付けられている (employer-level 確認)
    expect(getWorkplaceEmployedPopSizeByType(state, holdingId, farmRef, 'peasants')).toBeCloseTo(
      capPeasants,
      0,
    )
  })

  it('maxRatio は employer 単位で適用される (2 farm で per-employer clamping を識別する)', () => {
    // 小作農 20 人を Farm B だけに pre-assign し Farm A には 0 人。大量の自作農 (未就業)。
    // Phase 2 で Farm A の小作農 room は 45.5 あるが未就業小作農は 0 (全員 Farm B に就業中)
    // → Farm A 小作農は 0 のまま → clampCapacityByMaxRatioPerEmployer で Farm A 自作農 = 0
    // holding-level 実装(誤り): 合計小作農 20 を参照し Farm A に自作農 ~19.5 を配置してしまう。
    const assetIdA = createRealEstateAssetId(0)
    const assetIdB = createRealEstateAssetId(1)
    const farmRefA = { kind: 'asset' as const, id: assetIdA }
    const farmRefB = { kind: 'asset' as const, id: assetIdB }
    const PEASANTS_B = 20 // Farm B にのみ、capacity (~45.5) 未満の小作農を配置

    const { state, holdingId } = setupFarmHolding([{ popType: 'freeholders', size: 10000 }])
    // Farm B を追加 (setupFarmHolding は Farm A だけ作る)
    const peasantIdB = createPopGroupId(200)
    const ws: WorldState = {
      ...state,
      realEstateAssets: {
        ...state.realEstateAssets,
        [assetIdB]: {
          id: assetIdB,
          holdingId,
          realEstateKind: 'farm',
          level: 1,
          createdWeek: 0,
          recipeSlots: {},
        },
      },
      realEstateAssetIndex: {
        ...state.realEstateAssetIndex,
        byHolding: {
          ...state.realEstateAssetIndex.byHolding,
          [holdingId as string]: [assetIdA, assetIdB],
        },
      },
      popGroups: {
        ...state.popGroups,
        [peasantIdB]: {
          id: peasantIdB,
          holdingId,
          class: 'lower' as const,
          popType: 'peasants' as const,
          employerId: farmRefB, // Farm B にのみ配置 (Farm A には小作農なし)
          size: PEASANTS_B,
          money: 0,
          needSatisfaction: 50,
          unrest: 10,
          attitudes: {},
        },
      },
      popIndex: {
        byHolding: {
          [holdingId]: [...(state.popIndex.byHolding[holdingId] ?? []), peasantIdB],
        },
      },
      nextPopGroupId: 1001,
    }

    // Farm B の peasants 容量 > PEASANTS_B のため Phase 1 では削られない前提
    const capPeasants = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'peasants')
    expect(capPeasants).toBeGreaterThan(PEASANTS_B)

    normalizePopEmploymentMut(ws, defaultConfig, holdingId)

    // Farm A 自作農 = 0: Farm A の小作農が 0 のため per-employer クランプで 0 になる。
    expect(getWorkplaceEmployedPopSizeByType(ws, holdingId, farmRefA, 'freeholders')).toBe(0)
    // Farm B 自作農 > 0: Farm B の小作農 (20) でキャップ → min(rawCap~19.5, 20) = ~19.5
    expect(
      getWorkplaceEmployedPopSizeByType(ws, holdingId, farmRefB, 'freeholders'),
    ).toBeGreaterThan(0)
    // Farm B の小作農は Phase 1 で削られていない (20 < capacity ~45.5)
    expect(getWorkplaceEmployedPopSizeByType(ws, holdingId, farmRefB, 'peasants')).toBeCloseTo(
      PEASANTS_B,
    )
  })
})
