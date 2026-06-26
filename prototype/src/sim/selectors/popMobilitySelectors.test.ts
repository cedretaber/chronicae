import { describe, expect, it } from 'vitest'
import { computeHoldingPopTypeDemand, computePopTypeMoneyQuantiles } from './popMobilitySelectors'
import { getHoldingPopTypeEffectiveCapacity } from './popSelectors'
import { normalizePopEmploymentMut } from '../tick/employmentRebalanceSystem'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { createProvinceId, createPopGroupId, createRealEstateAssetId } from '../types/ids'
import type { HoldingId, StateRegionId, PopGroupId } from '../types/ids'
import type { PopGroup, PopType, PopStratum } from '../types/popGroup'
import type { RealEstateAsset } from '../types/realEstateAsset'
import type { WorldState } from '../types/world'

const PROVINCE = createProvinceId('p', 0)

type PopSpec = {
  cls: PopStratum
  popType: PopType
  perCapMoney: number // v0.58: per-capita money (money = perCapMoney × size で seed)
  size: number
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
      employerId: null,
      size: spec.size,
      money: spec.perCapMoney * spec.size,
      needSatisfaction: 50,
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

describe('computePopTypeMoneyQuantiles', () => {
  it('computes size-weighted per-capita money quantiles per PopType within a state region', () => {
    // 同じ職能 (laborers) 内で半分が貧 (per-capita money 10)・半分が富 (90)、同サイズ。
    //   比較母集団は stratum ではなく職能単位 (v0.57.1)。
    const { state } = setupPops([
      { cls: 'lower', popType: 'laborers', perCapMoney: 10, size: 50 },
      { cls: 'lower', popType: 'laborers', perCapMoney: 90, size: 50 },
      { cls: 'lower', popType: 'artisans', perCapMoney: 50, size: 30 },
    ])

    const q = computePopTypeMoneyQuantiles(state, 'sr-0' as StateRegionId)

    // cumulative size weighting: p25 & median は per-capita money 10 群、p75 は 90 群。
    expect(q.laborers?.p25).toBe(10)
    expect(q.laborers?.median).toBe(10)
    expect(q.laborers?.p75).toBe(90)
    // artisans は別母集団として独立に算出される。
    expect(q.artisans?.p25).toBe(50)
    expect(q.artisans?.median).toBe(50)
    expect(q.peasants).toBeUndefined() // no peasants pops
  })
})

describe('computeHoldingPopTypeDemand', () => {
  it('施設が無ければ雇用需要は発生しない (idealShare 0)', () => {
    // v0.57: 施設駆動。施設 (asset/improvement) が無い holding は雇用容量 0 → 需要なし。
    const { state, holdingId } = setupPops([
      { cls: 'lower', popType: 'laborers', perCapMoney: 50, size: 30 },
      { cls: 'lower', popType: 'peasants', perCapMoney: 50, size: 10 },
    ])
    // withProvince が付与した critical infra (manor_house) を外して「施設なし」にする。
    state.holdingImprovements = {}
    state.holdingImprovementIndex = { byHolding: {} }

    const d = computeHoldingPopTypeDemand(state, defaultConfig, holdingId)

    // v0.63 Phase 1-2: 全 POP が employerId: null のため currentEmployedByType は空 (isEmployed=false)。
    // Phase 3-4 で employer 紐付け後に currentEmployedByType と surplusByType を再確認する。
    expect(d.currentEmployedByType.laborers ?? 0).toBe(0)
    expect(d.currentEmployedByType.peasants ?? 0).toBe(0)
    // 施設容量ゼロ → desired/idealShare ともに 0。
    expect(d.idealShareByType.laborers ?? 0).toBe(0)
    expect(d.desiredEmployedByType.laborers ?? 0).toBe(0)
    // surplus = max(0, current 0 - desired 0) = 0 (Phase 1-2 は全員失業扱い、施設なしなら surplus なし)。
    expect(d.surplusByType.laborers ?? 0).toBe(0)
  })

  it('idealShare と shortage を施設の職能構成から導く', () => {
    const { state, holdingId } = setupPops([]) // no employed pops
    // 施設駆動の構成を分離して見るため critical infra を外し、farm asset だけにする。
    state.holdingImprovements = {}
    state.holdingImprovementIndex = { byHolding: {} }
    const assetId = createRealEstateAssetId(0)
    const asset: RealEstateAsset = {
      id: assetId,
      holdingId,
      realEstateKind: 'farm', // 小作農:自作農 = 7:3
      level: 1,
      createdWeek: 0,
      recipeSlots: {},
    }
    state.realEstateAssets[assetId] = asset
    state.realEstateAssetIndex.byHolding[holdingId as string] = [assetId]

    const d = computeHoldingPopTypeDemand(state, defaultConfig, holdingId)

    // farm は小作農:自作農 = 7:3 のみ。idealShare は holding 全体正規化 (v0.57.1) なので
    //   peasants=0.7 / freeholders=0.3 となる (旧: stratum 内正規化で各 1.0)。
    expect(d.idealShareByType.peasants).toBeCloseTo(0.7)
    expect(d.idealShareByType.freeholders).toBeCloseTo(0.3)
    expect(d.idealShareByType.laborers ?? 0).toBe(0)
    // farm は peasants 容量を持ち、employed 0 なので shortage == desired > 0。
    expect(d.desiredEmployedByType.peasants!).toBeGreaterThan(0)
    expect(d.shortageByType.peasants).toBeCloseTo(d.desiredEmployedByType.peasants!)
    // desired:peasants/freeholders は 7:3 の容量比を反映する。
    expect(d.desiredEmployedByType.peasants! / d.desiredEmployedByType.freeholders!).toBeCloseTo(
      35 / 15,
    )
  })
})

// v0.59 追補: maxRatio 後の実効容量。熟練職 (自作農) は下層同種職 (小作農) の実雇用数 × ratio で頭打ち。
// v0.63 Task 4: normalizePopEmploymentMut を呼び出して employment を確定させる。
function setupFarm(specs: PopSpec[]): { state: WorldState; holdingId: HoldingId } {
  const { state, holdingId } = setupPops(specs)
  state.holdingImprovements = {}
  state.holdingImprovementIndex = { byHolding: {} }
  const assetId = createRealEstateAssetId(0)
  const asset: RealEstateAsset = {
    id: assetId,
    holdingId,
    realEstateKind: 'farm', // 小作農:自作農 = 7:3
    level: 1,
    createdWeek: 0,
    recipeSlots: {},
  }
  state.realEstateAssets[assetId] = asset
  state.realEstateAssetIndex.byHolding[holdingId as string] = [assetId]
  // employer 紐付けを確定させて以降の selector が実雇用数を参照できるようにする。
  normalizePopEmploymentMut(state, defaultConfig, holdingId)
  return { state, holdingId }
}

describe('getHoldingPopTypeEffectiveCapacity (v0.59 追補)', () => {
  it('自作農の実効容量は小作農の実雇用数で頭打ちになる (Phase 3-4 再有効化)', () => {
    // 小作農を 2 人だけ雇用 → 自作農の実効容量 = min(生容量, 2×1) = 2。
    // setupFarm が normalizePopEmploymentMut を呼び出すため peasants の employer 紐付けが確定する。
    const { state, holdingId } = setupFarm([
      { cls: 'lower', popType: 'peasants', perCapMoney: 1, size: 2 },
    ])
    const effFree = getHoldingPopTypeEffectiveCapacity(
      state,
      defaultConfig,
      holdingId,
      'freeholders',
    )
    expect(effFree).toBeCloseTo(2)
    // maxRatio 無しの小作農は生容量そのまま (頭打ちされない)。
    const effPeasants = getHoldingPopTypeEffectiveCapacity(
      state,
      defaultConfig,
      holdingId,
      'peasants',
    )
    expect(effPeasants).toBeGreaterThan(2)
  })

  it('小作農が十分なら自作農は生容量まで使える (Phase 3-4 再有効化)', () => {
    const { state, holdingId } = setupFarm([
      { cls: 'lower', popType: 'peasants', perCapMoney: 1, size: 100000 },
    ])
    const effFree = getHoldingPopTypeEffectiveCapacity(
      state,
      defaultConfig,
      holdingId,
      'freeholders',
    )
    expect(effFree).toBeGreaterThan(0)
  })
})

describe('computeHoldingPopTypeDemand 実効容量 shortage (v0.59 追補)', () => {
  it('下層が薄いと自作農の shortage は実効容量で 0 になる (幻の需要を出さない)', () => {
    // 小作農・自作農とも未雇用。farm は自作農の生容量 > 0 を持つが、小作農 0 雇用なので
    //   自作農の実効容量 = 0 → shortage.freeholders は出ない。一方 idealShare は構造的に 0.3。
    const { state, holdingId } = setupFarm([])
    const d = computeHoldingPopTypeDemand(state, defaultConfig, holdingId)
    expect(d.shortageByType.freeholders ?? 0).toBe(0)
    expect(d.shortageByType.peasants!).toBeGreaterThan(0) // 小作農は maxRatio 無しなので shortage 出る
    expect(d.idealShareByType.freeholders).toBeCloseTo(0.3) // idealShare は生容量基準で構造維持
  })

  it('小作農を十分雇用すると自作農の shortage が現れる (Phase 3-4 再有効化)', () => {
    const { state, holdingId } = setupFarm([
      { cls: 'lower', popType: 'peasants', perCapMoney: 1, size: 100000 },
    ])
    const d = computeHoldingPopTypeDemand(state, defaultConfig, holdingId)
    expect(d.shortageByType.freeholders!).toBeGreaterThan(0)
  })
})
