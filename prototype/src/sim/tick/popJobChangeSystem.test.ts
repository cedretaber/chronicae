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
  _employed: boolean, // v0.63: field removed; kept for call-site compat
  size: number,
  perCapMoney: number, // v0.58: 昇格/降格 gate は per-capita money。money = perCapMoney × size で seed。
): Omit<PopGroup, 'id' | 'holdingId' | 'attitudes'> {
  return {
    class: cls,
    popType,
    employerId: null,
    size,
    money: perCapMoney * size,
    needSatisfaction: 50,
    unrest: 10,
  }
}

// holding 内の (popType, employed) 別の合計 size。
function sizeOf(
  state: WorldState,
  holdingId: HoldingId,
  popType: PopType,
  employed: boolean,
): number {
  return getHoldingPopsByClassAndEmployment(state, holdingId, getStratum(popType), employed)
    .filter((p) => p.popType === popType)
    .reduce((s, p) => s + p.size, 0)
}
function getStratum(popType: PopType): PopStratum {
  if (['nobles', 'patricians'].includes(popType)) return 'upper'
  if (['bureaucrats', 'freeholders', 'masters', 'merchants', 'ministeriales'].includes(popType))
    return 'middle'
  return 'lower'
}

describe('PopJobChangeSystem (v0.59 追補: per-source cap + 移動/雇用分離)', () => {
  it('lateral は capacity に関係なく発火し、移動先では失業着地する', () => {
    // lower stratum が laborers で満員 (remaining capacity ゼロ) でも lateral laborers→peasants は起きる。
    const { state, holdingId } = setup([])
    const capLower = getHoldingClassCapacity(state, defaultConfig, holdingId, 'lower')
    expect(capLower).toBeGreaterThan(0)

    const lab = createPopGroupId(100)
    state.popGroups[lab] = {
      id: lab,
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employerId: null,
      size: capLower, // fully fills lower capacity
      money: 0,
      needSatisfaction: 50,
      unrest: 10,
      attitudes: {},
    }
    state.popIndex.byHolding[holdingId] = [lab]

    const result = run(state)

    // v0.59 追補: lateral は移動先で失業着地する (employed=false)。雇用は後段 rebalance が確定。
    expect(sizeOf(result, holdingId, 'peasants', false)).toBeGreaterThan(0)
  })

  it('cap は per-source: 1 source は size × kind 別レートまでしか動かない (holding 予算ではない)', () => {
    // 失業 laborers (size 100)。lateral laborers→peasants (shortage あり) が rate 0.02 で発火。
    //   旧 holding 予算 (size×0.001=0.1) ではなく source rate (100×0.02=2) が cap になる。
    const { state } = setup([mk('lower', 'laborers', false, 100, 0)])
    const result = run(state)
    const lateralRate = defaultConfig.popJobChangeMonthlyRateByKind.lateral
    expect(result.monthlyPopMobility!.jobChangedTotal).toBeGreaterThan(100 * 0.001) // 旧予算超え
    expect(result.monthlyPopMobility!.jobChangedTotal).toBeLessThanOrEqual(100 * lateralRate + 1e-9)
  })

  it('小 holding (総 size < 10) でも失業中産の降格が凍結しない', () => {
    // 旧版: holding 予算 = 5×0.001 = 0.005 < minMove(0.01) で全移動が凍結していた。
    //   per-source cap では失業 freeholders が demotion rate (0.01) で peasants へ降格できる。
    const { state, holdingId } = setup([mk('middle', 'freeholders', false, 5, 1)])
    const result = run(state)
    // freeholders→peasants の降格が起き、移動先 (peasants) は失業着地。
    expect(sizeOf(result, holdingId, 'peasants', false)).toBeGreaterThan(0)
  })

  it.skip('C3: promotion は相対的に裕福な source で発火し、wealth が一様なら発火しない (Phase 3-4 再有効化)', () => {
    // v0.63 Phase 1-2: 全 POP が employerId: null のため employed peasant anchor = 0
    //   → freeholder 実効容量 = 0 → 昇格なし。Phase 3-4 で employer 紐付け後に再確認する。
    // v0.59 追補: freeholders は実効容量 (= 雇用 peasants × maxRatio) で gate されるため、
    //   昇格先の枠を生むには雇用済み小作農のアンカーが必要。昇格者は移動先で失業着地する。
    const ANCHOR = mk('lower', 'peasants', true, 1000, 50)
    const spread = setup([
      ANCHOR,
      mk('lower', 'peasants', false, 100, 10),
      mk('lower', 'peasants', false, 100, 50),
      mk('lower', 'peasants', false, 100, 90),
    ])
    const spreadResult = run(spread.state)
    // wealth-90 の peasant が p75 + median gate を超えて freeholders へ昇格 (失業着地)。
    expect(sizeOf(spreadResult, spread.holdingId, 'freeholders', false)).toBeGreaterThan(0)

    const flat = setup([
      ANCHOR,
      mk('lower', 'peasants', false, 100, 50),
      mk('lower', 'peasants', false, 100, 50),
      mk('lower', 'peasants', false, 100, 50),
    ])
    const flatResult = run(flat.state)
    expect(sizeOf(flatResult, flat.holdingId, 'freeholders', false)).toBe(0)
  })

  it('昇格は移動先の実効職枠が無いと発火しない (下層アンカー無し)', () => {
    // 雇用済み小作農が居ないと freeholders 実効容量 = 0 → 裕福な失業 peasant でも昇格できない。
    const noAnchor = setup([
      mk('lower', 'peasants', false, 100, 10),
      mk('lower', 'peasants', false, 100, 50),
      mk('lower', 'peasants', false, 100, 90),
    ])
    const result = run(noAnchor.state)
    expect(sizeOf(result, noAnchor.holdingId, 'freeholders', false)).toBe(0)
    expect(sizeOf(result, noAnchor.holdingId, 'freeholders', true)).toBe(0)
  })
})
