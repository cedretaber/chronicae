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
      employed: false,
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

    // それぞれ自分の PopType 容量まで雇用される (互いに干渉しない)。
    expect(getHoldingEmployedPopSizeByType(state, holdingId, 'peasants')).toBeCloseTo(capPeasants)
    expect(getHoldingEmployedPopSizeByType(state, holdingId, 'laborers')).toBeCloseTo(capLaborers)
  })

  it('熟練職 (自作農) は主要職能 (小作農) の実雇用数までしか雇えない (同数上限)', () => {
    // 小作農を少量 (容量内) ・自作農を大量。自作農枠は十分あるが小作農の実数で頭打ちになる。
    const { state, holdingId } = setupFarmHolding([
      { popType: 'peasants', size: 100 },
      { popType: 'freeholders', size: 100000 },
    ])

    const capPeasants = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'peasants')
    const capFreeholders = getHoldingPopTypeCapacity(state, defaultConfig, holdingId, 'freeholders')
    // 前提: 小作農容量は 100 より大きく全員就業でき、自作農容量も 100 より大きい (上限が同数で効く)。
    expect(capPeasants).toBeGreaterThan(100)
    expect(capFreeholders).toBeGreaterThan(100)

    normalizePopEmploymentMut(state, defaultConfig, holdingId)

    const employedPeasants = getHoldingEmployedPopSizeByType(state, holdingId, 'peasants')
    const employedFreeholders = getHoldingEmployedPopSizeByType(state, holdingId, 'freeholders')
    expect(employedPeasants).toBe(100)
    // 同数上限: 自作農は小作農の実雇用数 (100) でキャップされる。
    expect(employedFreeholders).toBe(100)
  })
})
