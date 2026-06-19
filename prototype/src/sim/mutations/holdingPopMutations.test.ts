import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import type { HoldingId, HouseId } from '../types/ids'
import {
  addToOrCreatePopGroupMut,
  adjustHoldingPopWealthMut,
  adjustHoldingPopUnrestMut,
  reduceHoldingPopSizeProportionalMut,
} from './popMutations'
import { adjustHoldingPopAttitudeMut } from './attitudeMutations'

const H1 = 'hl-1' as HoldingId
const H2 = 'hl-2' as HoldingId

function setup() {
  const ws = makeEmptyV016State()
  // 同一 province の 2 holding に peasant POP を 1 つずつ (province 多重の罠を検出するため)
  const p1 = addToOrCreatePopGroupMut(ws, {
    holdingId: H1,
    class: 'peasants',
    employed: true,
    size: 100,
  })
  const p2 = addToOrCreatePopGroupMut(ws, {
    holdingId: H2,
    class: 'peasants',
    employed: true,
    size: 100,
  })
  ws.popGroups[p1] = { ...ws.popGroups[p1]!, wealth: 50, unrest: 10 }
  ws.popGroups[p2] = { ...ws.popGroups[p2]!, wealth: 50, unrest: 10 }
  return { ws, p1, p2 }
}

describe('holding-scoped pop/attitude mutable helpers', () => {
  it('adjustHoldingPopWealthMut は対象 holding の POP のみ変える (province 多重しない)', () => {
    const { ws, p1, p2 } = setup()
    adjustHoldingPopWealthMut(ws, H1, -8)
    expect(ws.popGroups[p1]!.wealth).toBe(42)
    expect(ws.popGroups[p2]!.wealth).toBe(50) // 別 holding は不変
  })

  it('wealth / unrest は [0,100] に clamp される', () => {
    const { ws, p1 } = setup()
    adjustHoldingPopWealthMut(ws, H1, -999)
    expect(ws.popGroups[p1]!.wealth).toBe(0)
    adjustHoldingPopUnrestMut(ws, H1, 999)
    expect(ws.popGroups[p1]!.unrest).toBe(100)
  })

  it('reduceHoldingPopSizeProportionalMut は size×rate を 1 回だけ減らす', () => {
    const { ws, p1, p2 } = setup()
    reduceHoldingPopSizeProportionalMut(ws, H1, 0.1)
    expect(ws.popGroups[p1]!.size).toBeCloseTo(90)
    expect(ws.popGroups[p2]!.size).toBe(100)
  })

  it('class フィルタが効く (非該当 class は不変)', () => {
    const { ws, p1 } = setup()
    adjustHoldingPopWealthMut(ws, H1, -8, 'nobles')
    expect(ws.popGroups[p1]!.wealth).toBe(50) // commoner なので noble 指定では不変
  })

  it('adjustHoldingPopAttitudeMut は対象 holding の POP attitude を動かす', () => {
    const { ws, p1, p2 } = setup()
    const house = 'h-1' as HouseId
    adjustHoldingPopAttitudeMut(ws, H1, { kind: 'house', id: house }, { affection: -5 })
    const key = `house:${house}`
    expect(ws.popGroups[p1]!.attitudes[key]?.affection).toBe(-5)
    expect(ws.popGroups[p2]!.attitudes[key]).toBeUndefined()
  })
})
