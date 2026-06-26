import { describe, expect, it } from 'vitest'
import { normalizePopEmploymentMut } from './employmentRebalanceSystem'
import {
  getHoldingPopTypeCapacity,
  getHoldingEmployedPopSizeByType,
} from '../selectors/popSelectors'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createProvinceId, createPopGroupId, createRealEstateAssetId } from '../types/ids'
import type { HoldingId, PopGroupId } from '../types/ids'
import type { PopGroup, PopType } from '../types/popGroup'
import { getPopStratum } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'

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

    // v0.63 Phase 1-2: 全 POP が employerId: null のため、null→null は同一 merge key → no-op。
    // Phase 3-4 で employer 紐付け後に「各 PopType 容量まで雇用」動作を再確認する。
    expect(getHoldingEmployedPopSizeByType(state, holdingId, 'peasants')).toBe(0)
    expect(getHoldingEmployedPopSizeByType(state, holdingId, 'laborers')).toBe(0)
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

    // v0.63 Phase 1-2: 全 POP が employerId: null のため rebalance は no-op。
    // Phase 3-4 で employer 紐付け後に「同数上限」動作を再確認する。
    const employedPeasants = getHoldingEmployedPopSizeByType(state, holdingId, 'peasants')
    const employedFreeholders = getHoldingEmployedPopSizeByType(state, holdingId, 'freeholders')
    expect(employedPeasants).toBe(0)
    expect(employedFreeholders).toBe(0)
  })
})
