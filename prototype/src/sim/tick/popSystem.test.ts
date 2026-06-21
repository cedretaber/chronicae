import { describe, it, expect } from 'vitest'
import { normalizePopSizes } from './popSystem'
import { makeEmptyV016State, withProvince, withHolding } from '../testFixtures'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { WorldState } from '../types/world'
import type { PopGroup, PopStratum, PopType } from '../types/popGroup'
import type { ProvinceId, HoldingId, PopGroupId } from '../types/ids'

const REP_POP_TYPE: Record<PopStratum, PopType> = {
  lower: 'peasants',
  middle: 'freeholders',
  upper: 'nobles',
}

let counter = 0
function withPop(
  state: WorldState,
  holdingId: HoldingId,
  popClass: PopStratum,
  size: number,
  employed: boolean,
): WorldState {
  const id = ('pg-' + counter++) as PopGroupId
  const pop: PopGroup = {
    id,
    holdingId,
    class: popClass,
    popType: REP_POP_TYPE[popClass],
    employed,
    size,
    wealth: 50,
    unrest: 0,
    attitudes: {},
  }
  const existing = state.popIndex.byHolding[holdingId] ?? []
  return {
    ...state,
    popGroups: { ...state.popGroups, [id]: pop },
    popIndex: { byHolding: { ...state.popIndex.byHolding, [holdingId]: [...existing, id] } },
  }
}

function baseState(): { state: WorldState; holding: HoldingId } {
  let state = makeEmptyV016State()
  state = withProvince(state, 'pr-0' as ProvinceId, {})
  const holding = 'hd-0' as HoldingId
  state = withHolding(state, holding, 'pr-0' as ProvinceId, { kind: 'manor' })
  return { state, holding }
}

describe('normalizePopSizes (v0.55 POP 再設計)', () => {
  it('就業 POP を minSize へ底上げしない (人口生成ポンプ撤廃)', () => {
    const built = baseState()
    const holding = built.holding
    let state = built.state
    // minPopSizeByClass.upper=1 だが、就業 upper を 0.1 で置く
    state = withPop(state, holding, 'upper', 0.1, true)
    const ctx = createTickContext({ state, config: defaultConfig, rng: createRng('t') })
    const out = normalizePopSizes(ctx).state
    const pop = Object.values(out.popGroups).find((p) => p.class === 'upper')
    expect(pop?.size).toBeCloseTo(0.1, 4) // minSize=1 に底上げされない
  })

  it('epsilon 以下の POP は employed/unemployed を問わず除去する', () => {
    const built = baseState()
    const holding = built.holding
    let state = built.state
    state = withPop(state, holding, 'lower', 0.001, false) // unemployed, epsilon 以下
    state = withPop(state, holding, 'middle', 0.001, true) // employed, epsilon 以下
    state = withPop(state, holding, 'lower', 10, true) // 通常サイズは残る
    const ctx = createTickContext({ state, config: defaultConfig, rng: createRng('t') })
    const out = normalizePopSizes(ctx).state
    const sizes = Object.values(out.popGroups)
      .map((p) => p.size)
      .sort((a, b) => a - b)
    expect(sizes).toEqual([10]) // epsilon 以下の 2 つは除去、10 のみ残る
  })
})
