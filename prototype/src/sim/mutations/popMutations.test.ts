import { describe, expect, it } from 'vitest'
import {
  reduceProvincePopSizeProportional,
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
    employed: true,
    size,
    money,
    needSatisfaction: 50,
    unrest: 0,
    attitudes: {},
  }
}

// Province with two holdings, each carrying one peasant pop + one townsmen pop.
function makeFixture(): { state: WorldState; provinceId: ProvinceId } {
  const provinceId = createProvinceId('p', 0)
  const h0 = createHoldingId(0)
  const h1 = createHoldingId(1)
  const peas0 = createPopGroupId(0)
  const peas1 = createPopGroupId(1)
  const town0 = createPopGroupId(2)

  let state = makeEmptyV016State()
  state = withProvince(state, provinceId)
  state = withHolding(state, h0, provinceId)
  state = withHolding(state, h1, provinceId)
  state = {
    ...state,
    popGroups: {
      [peas0]: pop(peas0, h0, 'lower', 100),
      [peas1]: pop(peas1, h1, 'lower', 200),
      [town0]: pop(town0, h0, 'middle', 50),
    },
    popIndex: { byHolding: { [h0]: [peas0, town0], [h1]: [peas1] } },
  }
  return { state, provinceId }
}

describe('reduceProvincePopSizeProportional', () => {
  it('reduces each pop by its OWN proportion (no N× over-application across pops)', () => {
    const { state, provinceId } = makeFixture()
    const result = reduceProvincePopSizeProportional(state, provinceId, 0.1, 'lower')

    // Each peasant pop loses 10% of ITS size, independent of the other pop's size.
    expect(result.popGroups[createPopGroupId(0)]!.size).toBe(90) // 100 - 100*0.1
    expect(result.popGroups[createPopGroupId(1)]!.size).toBe(180) // 200 - 200*0.1
    // townsmen untouched by the class filter
    expect(result.popGroups[createPopGroupId(2)]!.size).toBe(50)
  })

  it('without a class filter, reduces every pop proportionally', () => {
    const { state, provinceId } = makeFixture()
    const result = reduceProvincePopSizeProportional(state, provinceId, 0.05)

    expect(result.popGroups[createPopGroupId(0)]!.size).toBe(95)
    expect(result.popGroups[createPopGroupId(1)]!.size).toBe(190)
    expect(result.popGroups[createPopGroupId(2)]!.size).toBeCloseTo(47.5)
  })

  it('clamps to >= 0 and is a no-op when rate is 0', () => {
    const { state, provinceId } = makeFixture()
    expect(reduceProvincePopSizeProportional(state, provinceId, 0)).toBe(state)

    const wiped = reduceProvincePopSizeProportional(state, provinceId, 1, 'lower')
    expect(wiped.popGroups[createPopGroupId(0)]!.size).toBe(0)
    expect(wiped.popGroups[createPopGroupId(1)]!.size).toBe(0)
  })
})

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

  it('reduceProvincePopSizeProportional burns money proportionally (per-capita preserved)', () => {
    const { state, provinceId } = moneyFixture()
    const result = reduceProvincePopSizeProportional(state, provinceId, 0.3)
    const after = result.popGroups[createPopGroupId(0)]!
    expect(after.size).toBe(70)
    expect(after.money).toBeCloseTo(700) // 1000 * (70/100)
    expect(after.money / after.size).toBeCloseTo(10) // per-capita 不変
  })

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
      employed: true,
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
      { holdingId, class: 'lower', popType: 'peasants', employed: true },
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
      { holdingId, class: 'lower', popType: 'peasants', employed: true },
      100,
    )
    const total = Object.values(state.popGroups).reduce((a, p) => a + p.money, 0)
    expect(total).toBeCloseTo(1000, 6)
    expect(state.popGroups[srcId]).toBeUndefined() // source は drain で除去
  })

  it('movePopEmploymentMut: 雇用状態変更で money は比例移送 (複製しない・total 保存)', () => {
    const { state, srcId } = moneyFixture()
    movePopEmploymentMut(state, { sourcePopId: srcId, targetEmployed: false, size: 50 })
    const total = Object.values(state.popGroups).reduce((a, p) => a + p.money, 0)
    expect(total).toBeCloseTo(1000, 6) // 複製されない
    const moved = Object.values(state.popGroups).find((p) => !p.employed)
    expect(moved?.money).toBeCloseTo(500, 6)
    expect(state.popGroups[srcId]?.money).toBeCloseTo(500, 6)
  })

  it('addToOrCreatePopGroupMut: 同 key merge で money は sum (平均でなく)', () => {
    const { state, holdingId, srcId } = moneyFixture()
    const incoming: PopGroup = { ...state.popGroups[srcId]!, id: createPopGroupId(99), money: 200 }
    addToOrCreatePopGroupMut(state, {
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employed: true,
      size: 50,
      inheritFrom: incoming,
    })
    // 既存 laborers (money 1000) に incoming 比例分 (money 200) が sum される。
    expect(state.popGroups[srcId]?.money).toBeCloseTo(1200, 6)
  })
})
