import { describe, it, expect } from 'vitest'
import {
  createMonthlyPopChangeSnapshot,
  popGroupChangeKey,
  accrueNaturalPopChangeMut,
  accrueMigrationInPopChangeMut,
  accrueMigrationOutPopChangeMut,
} from './popChangeSnapshot'
import type { WorldState } from '../types/world'
import type { HoldingId } from '../types/ids'

const H1 = 'h-1' as HoldingId
const H2 = 'h-2' as HoldingId

function makeWs(withSnapshot: boolean): WorldState {
  const ws = { absoluteWeek: 100 } as unknown as WorldState
  if (withSnapshot) ws.monthlyPopChange = createMonthlyPopChangeSnapshot(100)
  return ws
}

describe('popChangeSnapshot', () => {
  it('popGroupChangeKey は holding|class|popType|employed 形式', () => {
    expect(popGroupChangeKey(H1, 'lower', 'peasants', true)).toBe('h-1|lower|peasants|true')
    expect(popGroupChangeKey(H1, 'lower', 'peasants', false)).toBe('h-1|lower|peasants|false')
  })

  it('createMonthlyPopChangeSnapshot は空の read-model を作る', () => {
    const s = createMonthlyPopChangeSnapshot(42)
    expect(s.week).toBe(42)
    expect(s.byHolding).toEqual({})
    expect(s.byPopGroupKey).toEqual({})
  })

  it('自然増減を holding と pop group key の両方に累積する (正負を加算)', () => {
    const ws = makeWs(true)
    accrueNaturalPopChangeMut(ws, H1, 'lower', 'peasants', true, 5)
    accrueNaturalPopChangeMut(ws, H1, 'lower', 'peasants', true, -2)
    const s = ws.monthlyPopChange!
    expect(s.byHolding[H1]?.natural).toBeCloseTo(3)
    expect(s.byPopGroupKey['h-1|lower|peasants|true']?.natural).toBeCloseTo(3)
  })

  it('移住流入・流出を holding 単位で正しく集計する', () => {
    const ws = makeWs(true)
    accrueMigrationOutPopChangeMut(ws, H1, 'lower', 'peasants', true, 4)
    accrueMigrationInPopChangeMut(ws, H2, 'lower', 'peasants', true, 4)
    const s = ws.monthlyPopChange!
    expect(s.byHolding[H1]?.migrationOut).toBeCloseTo(4)
    expect(s.byHolding[H1]?.migrationIn).toBeCloseTo(0)
    expect(s.byHolding[H2]?.migrationIn).toBeCloseTo(4)
    expect(s.byHolding[H2]?.migrationOut).toBeCloseTo(0)
  })

  it('holding 合計の純変動は natural + migrationIn − migrationOut で表せる', () => {
    const ws = makeWs(true)
    accrueNaturalPopChangeMut(ws, H1, 'lower', 'peasants', true, 10)
    accrueMigrationInPopChangeMut(ws, H1, 'lower', 'peasants', true, 3)
    accrueMigrationOutPopChangeMut(ws, H1, 'lower', 'peasants', true, 5)
    const e = ws.monthlyPopChange!.byHolding[H1]!
    expect(e.natural + e.migrationIn - e.migrationOut).toBeCloseTo(8)
  })

  it('snapshot 未生成のときは no-op (throw しない)', () => {
    const ws = makeWs(false)
    expect(() => accrueNaturalPopChangeMut(ws, H1, 'lower', 'peasants', true, 5)).not.toThrow()
    expect(ws.monthlyPopChange).toBeUndefined()
  })

  it('delta 0 / amount 0 はエントリを作らない', () => {
    const ws = makeWs(true)
    accrueNaturalPopChangeMut(ws, H1, 'lower', 'peasants', true, 0)
    accrueMigrationInPopChangeMut(ws, H1, 'lower', 'peasants', true, 0)
    expect(ws.monthlyPopChange!.byHolding[H1]).toBeUndefined()
  })
})
