import { describe, expect, it } from 'vitest'
import {
  reduceHoldingPopSizeProportionalMut,
  movePopSizeToKeyMut,
  movePopEmploymentMut,
  addToOrCreatePopGroupMut,
} from './popMutations'
import { makeEmptyV016State, withProvince, withHolding } from '../testFixtures'
import { createProvinceId, createHoldingId, createPopGroupId } from '../types/ids'
import type { ProvinceId, HoldingId, PopGroupId } from '../types/ids'
import type { PopGroup, PopClass } from '../types/popGroup'
import type { WorldState } from '../types/world'

function pop(
  id: PopGroupId,
  holdingId: HoldingId,
  popClass: PopClass,
  size: number,
  money = 0,
): PopGroup {
  return {
    id,
    holdingId,
    class: popClass,
    popType: popClass === 'lower' ? 'peasants' : popClass === 'middle' ? 'freeholders' : 'nobles',
    employerId: null,
    size,
    money,
    needSatisfaction: 50,
    unrest: 0,
    attitudes: {},
  }
}

// v0.58: crisis 死亡 (size 比例減) は money も per-capita 保存のため比例 burn する
//   (popSystem の自然死亡と同規約)。怠ると生存者の per-capita money が膨らみ飢饉が報われる。
describe('v0.58 money 保存 (crisis 死亡 = 比例 burn)', () => {
  function moneyFixture(): { state: WorldState; provinceId: ProvinceId; holdingId: HoldingId } {
    const provinceId = createProvinceId('p', 0)
    const holdingId = createHoldingId(0)
    const peas = createPopGroupId(0)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId)
    state = withHolding(state, holdingId, provinceId)
    state = {
      ...state,
      popGroups: { [peas]: pop(peas, holdingId, 'lower', 100, 1000) },
      popIndex: { byHolding: { [holdingId]: [peas] } },
    }
    return { state, provinceId, holdingId }
  }

  it('reduceHoldingPopSizeProportionalMut burns money proportionally (per-capita preserved)', () => {
    const { state, holdingId } = moneyFixture()
    const ws: WorldState = {
      ...state,
      popGroups: { ...state.popGroups },
    }
    reduceHoldingPopSizeProportionalMut(ws, holdingId, 0.4)
    const after = ws.popGroups[createPopGroupId(0)]!
    expect(after.size).toBeCloseTo(60)
    expect(after.money).toBeCloseTo(600) // 1000 * (60/100)
    expect(after.money / after.size).toBeCloseTo(10) // per-capita 不変
  })

  it('v0.59: onReduce が減少した各 pop と除去量を通知する (crisis 死の自然減累積用)', () => {
    const { state, holdingId } = moneyFixture()
    const ws: WorldState = {
      ...state,
      popGroups: { ...state.popGroups },
    }
    const reports: { id: string; removed: number }[] = []
    reduceHoldingPopSizeProportionalMut(ws, holdingId, 0.4, undefined, (pop, removed) => {
      reports.push({ id: pop.id, removed })
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]!.removed).toBeCloseTo(40) // 100 * 0.4
  })
})

describe('v0.58 money 保存 (mobility/merge)', () => {
  function moneyFixture(): { state: WorldState; holdingId: HoldingId; srcId: PopGroupId } {
    const provinceId = createProvinceId('p', 0)
    const holdingId = createHoldingId(0)
    const srcId = createPopGroupId(0)
    let state = makeEmptyV016State()
    state = withProvince(state, provinceId)
    state = withHolding(state, holdingId, provinceId)
    const src: PopGroup = {
      id: srcId,
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employerId: null,
      size: 100,
      money: 1000,
      needSatisfaction: 50,
      unrest: 0,
      attitudes: {},
    }
    state = {
      ...state,
      popGroups: { [srcId]: src },
      popIndex: { byHolding: { [holdingId]: [srcId] } },
      nextPopGroupId: 1,
    }
    return { state, holdingId, srcId }
  }

  it('movePopSizeToKeyMut: 半分移動で money も半分移送 (total 保存)', () => {
    const { state, holdingId, srcId } = moneyFixture()
    movePopSizeToKeyMut(
      state,
      srcId,
      { holdingId, class: 'lower', popType: 'peasants', employerId: null },
      50,
    )
    const total = Object.values(state.popGroups).reduce((a, p) => a + p.money, 0)
    expect(total).toBeCloseTo(1000, 6)
    const moved = Object.values(state.popGroups).find((p) => p.popType === 'peasants')
    expect(moved?.money).toBeCloseTo(500, 6)
    expect(state.popGroups[srcId]?.money).toBeCloseTo(500, 6)
  })

  it('movePopSizeToKeyMut: source 全量移動 (sliver bump) でも total 保存', () => {
    const { state, holdingId, srcId } = moneyFixture()
    movePopSizeToKeyMut(
      state,
      srcId,
      { holdingId, class: 'lower', popType: 'peasants', employerId: null },
      100,
    )
    const total = Object.values(state.popGroups).reduce((a, p) => a + p.money, 0)
    expect(total).toBeCloseTo(1000, 6)
    expect(state.popGroups[srcId]).toBeUndefined() // source は drain で除去
  })

  it('movePopEmploymentMut: 同一 employerId (null→null) は no-op で total 保存', () => {
    // v0.63 Phase 1-2: 全 POP が employerId: null のため null→null は同一 merge key → no-op。
    // Phase 3-4 で employer 紐付け後にスプリット動作を検証する。
    const { state, srcId } = moneyFixture()
    movePopEmploymentMut(state, { sourcePopId: srcId, targetEmployerId: null, size: 50 })
    const total = Object.values(state.popGroups).reduce((a, p) => a + p.money, 0)
    expect(total).toBeCloseTo(1000, 6) // no-op: money 変化なし
    expect(state.popGroups[srcId]?.money).toBeCloseTo(1000, 6) // source unchanged
  })

  it('addToOrCreatePopGroupMut: 同 key merge で money は sum (平均でなく)', () => {
    const { state, holdingId, srcId } = moneyFixture()
    const incoming: PopGroup = { ...state.popGroups[srcId]!, id: createPopGroupId(99), money: 200 }
    addToOrCreatePopGroupMut(state, {
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employerId: null,
      size: 50,
      inheritFrom: incoming,
    })
    // 既存 laborers (money 1000) に incoming 比例分 (money 200) が sum される。
    expect(state.popGroups[srcId]?.money).toBeCloseTo(1200, 6)
  })
})
