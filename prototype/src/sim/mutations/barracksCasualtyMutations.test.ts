import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import {
  createHoldingId,
  createPopGroupId,
  createRegimentBarracksId,
  createRegimentId,
} from '../types/ids'
import type { HoldingId, PopGroupId, RegimentBarracksId, RegimentId } from '../types/ids'
import type { PopGroup } from '../types/popGroup'
import type { RegimentBarracks } from '../types/regimentBarracks'
import type { WorldState } from '../types/world'
import { reduceBarracksPopSizeMut, applyBarracksCasualtyMut } from './barracksCasualtyMutations'

const HOLDING_ID: HoldingId = createHoldingId(0)
const BARRACKS_ID: RegimentBarracksId = createRegimentBarracksId(0)
const REGIMENT_ID: RegimentId = createRegimentId(0)

function makeSoldiersPop(id: PopGroupId, size: number, money = 0): PopGroup {
  return {
    id,
    holdingId: HOLDING_ID,
    class: 'lower',
    popType: 'soldiers',
    employerId: { kind: 'barracks', id: BARRACKS_ID },
    size,
    money,
    needSatisfaction: 50,
    unrest: 10,
    attitudes: {},
  }
}

function makeMinisterialesPop(id: PopGroupId, size: number, money = 0): PopGroup {
  return {
    id,
    holdingId: HOLDING_ID,
    class: 'middle',
    popType: 'ministeriales',
    employerId: { kind: 'barracks', id: BARRACKS_ID },
    size,
    money,
    needSatisfaction: 50,
    unrest: 10,
    attitudes: {},
  }
}

function makeBarracks(opts: {
  requiredByPopType: Partial<Record<'soldiers' | 'ministeriales', number>>
}): RegimentBarracks {
  return {
    id: BARRACKS_ID,
    holdingId: HOLDING_ID,
    regimentId: REGIMENT_ID,
    requiredByPopType: opts.requiredByPopType,
    status: 'active',
    unpaidCount: 0,
    lastPayrollFulfillment: 1,
    createdWeek: 0,
  }
}

function setup(opts: {
  soldiersSize?: number
  soldiersPopMoney?: number
  ministerialesSize?: number
  requiredByPopType?: Partial<Record<'soldiers' | 'ministeriales', number>>
}): {
  ws: WorldState
  soldiersId: PopGroupId
  ministerialesId: PopGroupId
} {
  const soldiersId = createPopGroupId(0)
  const ministerialesId = createPopGroupId(1)

  const base = makeEmptyV016State()

  const popGroups: Record<string, PopGroup> = {}
  const byHolding: PopGroupId[] = []

  if (opts.soldiersSize !== undefined && opts.soldiersSize > 0) {
    popGroups[soldiersId] = makeSoldiersPop(
      soldiersId,
      opts.soldiersSize,
      opts.soldiersPopMoney ?? 0,
    )
    byHolding.push(soldiersId)
  }
  if (opts.ministerialesSize !== undefined && opts.ministerialesSize > 0) {
    popGroups[ministerialesId] = makeMinisterialesPop(ministerialesId, opts.ministerialesSize)
    byHolding.push(ministerialesId)
  }

  const barracks = makeBarracks({
    requiredByPopType: opts.requiredByPopType ?? { soldiers: 8, ministeriales: 2 },
  })

  const ws: WorldState = {
    ...base,
    popGroups,
    popIndex: { byHolding: { [HOLDING_ID]: byHolding } },
    nextPopGroupId: 2,
    regimentBarracks: { [BARRACKS_ID]: barracks },
    regimentBarracksIndex: {
      byHolding: { [HOLDING_ID]: [BARRACKS_ID] },
      byRegiment: { [REGIMENT_ID]: BARRACKS_ID },
    },
  }

  return { ws, soldiersId, ministerialesId }
}

describe('reduceBarracksPopSizeMut', () => {
  it('reduces matching pop size and money proportionally', () => {
    const { ws, soldiersId } = setup({ soldiersSize: 20, soldiersPopMoney: 200 })
    const reduced = reduceBarracksPopSizeMut(ws, HOLDING_ID, BARRACKS_ID, 'soldiers', 4)
    expect(reduced).toBeCloseTo(4)
    expect(ws.popGroups[soldiersId]?.size).toBeCloseTo(16)
    // money = 200 * (16/20) = 160
    expect(ws.popGroups[soldiersId]?.money).toBeCloseTo(160)
  })

  it('returns 0 for amount <= 0', () => {
    const { ws, soldiersId } = setup({ soldiersSize: 20 })
    const reduced = reduceBarracksPopSizeMut(ws, HOLDING_ID, BARRACKS_ID, 'soldiers', 0)
    expect(reduced).toBe(0)
    expect(ws.popGroups[soldiersId]?.size).toBe(20)
  })

  it('removes pop group when size reaches 0', () => {
    const soldiersId = createPopGroupId(0)
    const { ws } = setup({ soldiersSize: 5 })
    reduceBarracksPopSizeMut(ws, HOLDING_ID, BARRACKS_ID, 'soldiers', 5)
    expect(ws.popGroups[soldiersId]).toBeUndefined()
    // removePopGroupMut deletes the byHolding entry when the last POP is removed
    const remaining = ws.popIndex.byHolding[HOLDING_ID] ?? []
    expect(remaining).not.toContain(soldiersId)
  })

  it('does not affect pops of a different popType', () => {
    const { ws, ministerialesId } = setup({ soldiersSize: 10, ministerialesSize: 10 })
    reduceBarracksPopSizeMut(ws, HOLDING_ID, BARRACKS_ID, 'soldiers', 3)
    expect(ws.popGroups[ministerialesId]?.size).toBe(10)
  })
})

describe('applyBarracksCasualtyMut', () => {
  it('TC1: strengthDamage 25 with soldiers:8, ministeriales:2 → soldiers reduced by 2, ministeriales by 0.5', () => {
    const { ws, soldiersId, ministerialesId } = setup({
      soldiersSize: 20,
      ministerialesSize: 10,
      requiredByPopType: { soldiers: 8, ministeriales: 2 },
    })
    applyBarracksCasualtyMut(ws, BARRACKS_ID, 25)
    // soldiers: 8 * 25/100 = 2 → 20 - 2 = 18
    expect(ws.popGroups[soldiersId]?.size).toBeCloseTo(18)
    // ministeriales: 2 * 25/100 = 0.5 → 10 - 0.5 = 9.5
    expect(ws.popGroups[ministerialesId]?.size).toBeCloseTo(9.5)
  })

  it('TC2: strengthDamage=0 → no POP change', () => {
    const { ws, soldiersId, ministerialesId } = setup({
      soldiersSize: 20,
      ministerialesSize: 10,
    })
    const soldiersBefore = ws.popGroups[soldiersId]?.size
    const ministerBefore = ws.popGroups[ministerialesId]?.size
    applyBarracksCasualtyMut(ws, BARRACKS_ID, 0)
    expect(ws.popGroups[soldiersId]?.size).toBe(soldiersBefore)
    expect(ws.popGroups[ministerialesId]?.size).toBe(ministerBefore)
  })

  it('TC3: local_levy (empty requiredByPopType) → no-op', () => {
    const { ws, soldiersId } = setup({
      soldiersSize: 20,
      requiredByPopType: {},
    })
    const before = ws.popGroups[soldiersId]?.size
    applyBarracksCasualtyMut(ws, BARRACKS_ID, 50)
    expect(ws.popGroups[soldiersId]?.size).toBe(before)
  })

  it('TC4: money proportional burn — size=10, money=100, reduce by 2 → money=80', () => {
    const { ws, soldiersId } = setup({
      soldiersSize: 10,
      soldiersPopMoney: 100,
      requiredByPopType: { soldiers: 8 },
    })
    // strengthDamage = 25 → deathAmount = 8 * 25/100 = 2
    applyBarracksCasualtyMut(ws, BARRACKS_ID, 25)
    expect(ws.popGroups[soldiersId]?.size).toBeCloseTo(8)
    // money = 100 * (8/10) = 80
    expect(ws.popGroups[soldiersId]?.money).toBeCloseTo(80)
  })
})
