import { describe, expect, it } from 'vitest'
import { movePopSizeToKeyMut } from './popMutations'
import { makeEmptyV016State, withProvince, withHolding } from '../testFixtures'
import { createProvinceId, createHoldingId, createPopGroupId } from '../types/ids'
import type { HoldingId, PopGroupId } from '../types/ids'
import type { PopGroup, PopType, PopStratum } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { PopTargetKey } from '../types/popMobility'

const PROVINCE = createProvinceId('p', 0)
const H0 = createHoldingId(0)
const H1 = createHoldingId(1)

function mkPop(
  id: PopGroupId,
  holdingId: HoldingId,
  cls: PopStratum,
  popType: PopType,
  employed: boolean,
  size: number,
  money = 0,
  unrest = 10,
): PopGroup {
  return {
    id,
    holdingId,
    class: cls,
    popType,
    employed,
    size,
    money,
    needSatisfaction: 50,
    unrest,
    attitudes: {},
  }
}

function stateWithPops(pops: PopGroup[]): WorldState {
  let s = makeEmptyV016State()
  s = withProvince(s, PROVINCE)
  s = withHolding(s, H0, PROVINCE)
  s = withHolding(s, H1, PROVINCE)
  const popGroups: Record<PopGroupId, PopGroup> = {}
  const byHolding: Record<HoldingId, PopGroupId[]> = {}
  for (const p of pops) {
    popGroups[p.id] = p
    const list = byHolding[p.holdingId]
    if (list) list.push(p.id)
    else byHolding[p.holdingId] = [p.id]
  }
  return { ...s, popGroups, popIndex: { byHolding }, nextPopGroupId: 1000 }
}

describe('movePopSizeToKeyMut', () => {
  it('moves size to a new merge key in the same holding (job change)', () => {
    const src = createPopGroupId(1)
    const state = stateWithPops([mkPop(src, H0, 'lower', 'laborers', true, 100)])
    const target: PopTargetKey = {
      holdingId: H0,
      class: 'lower',
      popType: 'artisans',
      employed: true,
    }

    const tid = movePopSizeToKeyMut(state, src, target, 10)

    expect(tid).toBeDefined()
    expect(state.popGroups[src]!.size).toBe(90)
    expect(state.popGroups[tid!]!.popType).toBe('artisans')
    expect(state.popGroups[tid!]!.size).toBe(10)
    expect(state.popIndex.byHolding[H0]).toContain(tid)
  })

  it('migrates a positive amount across holdings', () => {
    const src = createPopGroupId(1)
    const state = stateWithPops([mkPop(src, H0, 'lower', 'laborers', true, 100)])

    const tid = movePopSizeToKeyMut(
      state,
      src,
      { holdingId: H1, class: 'lower', popType: 'laborers', employed: true },
      10,
    )

    expect(state.popGroups[tid!]!.holdingId).toBe(H1)
    expect(state.popIndex.byHolding[H1]).toContain(tid)
    expect(state.popGroups[src]!.size).toBe(90)
  })

  it('merges into existing target key: money は sum・unrest は人口加重平均 (no duplicate key)', () => {
    const src = createPopGroupId(1)
    const tgt = createPopGroupId(2)
    const state = stateWithPops([
      mkPop(src, H0, 'lower', 'laborers', true, 50, 20, 0), // money 20
      mkPop(tgt, H0, 'lower', 'artisans', true, 100, 80, 20), // money 80
    ])

    const tid = movePopSizeToKeyMut(
      state,
      src,
      { holdingId: H0, class: 'lower', popType: 'artisans', employed: true },
      50,
    )

    expect(tid).toBe(tgt) // merged into existing, not a new pop
    expect(state.popGroups[tgt]!.size).toBe(150)
    // v0.58: money は extensive → sum (src 全量 20 が移送され 80+20=100)。
    expect(state.popGroups[tgt]!.money).toBeCloseTo(100)
    expect(state.popGroups[tgt]!.unrest).toBeCloseTo((20 * 100 + 0 * 50) / 150) // ~13.33

    const artisans = state.popIndex.byHolding[H0]!.filter(
      (id) => state.popGroups[id]!.popType === 'artisans',
    )
    expect(artisans.length).toBe(1)
  })

  it('v0.58: moneyCostPerCapita で移送 money からコストを burn する (昇格コスト)', () => {
    const src = createPopGroupId(1)
    const state = stateWithPops([mkPop(src, H0, 'lower', 'peasants', true, 50, 70, 5)]) // money 70

    const tid = movePopSizeToKeyMut(
      state,
      src,
      { holdingId: H0, class: 'middle', popType: 'freeholders', employed: true },
      10,
      { moneyCostPerCapita: 0.5 },
    )

    // movedMoney = 70 × (10/50) = 14。cost = 0.5 × 10 = 5。target = 14 − 5 = 9。
    expect(state.popGroups[tid!]!.money).toBeCloseTo(9)
    // source は movedMoney 全額 (14) を失う → 70 − 14 = 56 (差額 5 が burn された)。
    expect(state.popGroups[src]!.money).toBeCloseTo(56)
  })

  it('keeps the source at the provided minSourceSize floor', () => {
    const src = createPopGroupId(1)
    const state = stateWithPops([mkPop(src, H0, 'lower', 'laborers', true, 5)])

    const tid = movePopSizeToKeyMut(
      state,
      src,
      { holdingId: H0, class: 'lower', popType: 'artisans', employed: true },
      10,
      { minSourceSize: 1 },
    )

    expect(state.popGroups[src]!.size).toBe(1) // not drained below floor, not removed
    expect(state.popGroups[tid!]!.size).toBe(4)
  })

  it('removes the source only when it falls to epsilon (default floor)', () => {
    const src = createPopGroupId(1)
    const state = stateWithPops([mkPop(src, H0, 'lower', 'laborers', true, 0.5)])

    const tid = movePopSizeToKeyMut(
      state,
      src,
      { holdingId: H1, class: 'lower', popType: 'laborers', employed: true },
      10,
    )

    // population conservation: the whole 0.5 is moved (no 0.01 leak) and the source is removed.
    expect(state.popGroups[src]).toBeUndefined()
    expect(state.popGroups[tid!]!.size).toBeCloseTo(0.5)
    expect(state.popIndex.byHolding[H0]).toBeUndefined()
  })

  it('throws on target stratum mismatch', () => {
    const src = createPopGroupId(1)
    const state = stateWithPops([mkPop(src, H0, 'lower', 'laborers', true, 100)])
    expect(() =>
      movePopSizeToKeyMut(
        state,
        src,
        { holdingId: H0, class: 'middle', popType: 'artisans', employed: true }, // artisans is lower
        10,
      ),
    ).toThrow()
  })

  it('is a no-op for identical key, non-positive amount, or missing source', () => {
    const src = createPopGroupId(1)
    const state = stateWithPops([mkPop(src, H0, 'lower', 'laborers', true, 100)])

    expect(
      movePopSizeToKeyMut(
        state,
        src,
        { holdingId: H0, class: 'lower', popType: 'laborers', employed: true },
        10,
      ),
    ).toBeUndefined()
    expect(
      movePopSizeToKeyMut(
        state,
        src,
        { holdingId: H1, class: 'lower', popType: 'laborers', employed: true },
        0,
      ),
    ).toBeUndefined()
    expect(
      movePopSizeToKeyMut(
        state,
        createPopGroupId(999),
        { holdingId: H1, class: 'lower', popType: 'laborers', employed: true },
        10,
      ),
    ).toBeUndefined()
    expect(state.popGroups[src]!.size).toBe(100) // unchanged throughout
  })
})
