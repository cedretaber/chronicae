import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import type { HoldingId, ProjectId } from '../types/ids'
import {
  createCrisisMut,
  setCrisisResponseProjectMut,
  setCrisisStatusMut,
  setCrisisSeverityMut,
  removeCrisisMut,
} from './crisisMutations'

const HOLDING = 'hl-1' as HoldingId

function makeInput(holdingId: HoldingId = HOLDING) {
  return {
    kind: 'famine' as const,
    holdingId,
    severity: 40,
    createdWeek: 0,
    deadlineWeek: 48,
    status: 'active' as const,
    reasonIds: [],
  }
}

describe('crisisMutations', () => {
  it('createCrisisMut が ID を採番し byHolding 索引へ登録する', () => {
    const ws = makeEmptyV016State()
    const c1 = createCrisisMut(ws, makeInput())
    expect(c1.id).toBe('cr-1')
    expect(ws.crises[c1.id]).toBeDefined()
    expect(ws.crisisIndex.byHolding[HOLDING as string]).toEqual([c1.id])
    expect(ws.nextCrisisId).toBe(2)
  })

  it('採番は単調増加する', () => {
    const ws = makeEmptyV016State()
    const c1 = createCrisisMut(ws, makeInput())
    const c2 = createCrisisMut(ws, makeInput())
    expect(c1.id).toBe('cr-1')
    expect(c2.id).toBe('cr-2')
    expect(ws.crisisIndex.byHolding[HOLDING as string]).toEqual([c1.id, c2.id])
  })

  it('setCrisisResponseProjectMut が byProject 索引を双方向に張る', () => {
    const ws = makeEmptyV016State()
    const c1 = createCrisisMut(ws, makeInput())
    const pid = 'pr-9' as ProjectId
    setCrisisResponseProjectMut(ws, c1.id, pid)
    expect(ws.crises[c1.id]?.responseProjectId).toBe(pid)
    expect(ws.crisisIndex.byProject[pid]).toEqual([c1.id])
  })

  it('setCrisisResponseProjectMut(undefined) で参照と索引を外す', () => {
    const ws = makeEmptyV016State()
    const c1 = createCrisisMut(ws, makeInput())
    const pid = 'pr-9' as ProjectId
    setCrisisResponseProjectMut(ws, c1.id, pid)
    setCrisisResponseProjectMut(ws, c1.id, undefined)
    expect(ws.crises[c1.id]?.responseProjectId).toBeUndefined()
    expect(ws.crisisIndex.byProject[pid]).toBeUndefined()
  })

  it('setCrisisStatusMut / setCrisisSeverityMut が値を更新し severity を [0,100] に clamp する', () => {
    const ws = makeEmptyV016State()
    const c1 = createCrisisMut(ws, makeInput())
    setCrisisStatusMut(ws, c1.id, 'resolved')
    expect(ws.crises[c1.id]?.status).toBe('resolved')
    setCrisisSeverityMut(ws, c1.id, 150)
    expect(ws.crises[c1.id]?.severity).toBe(100)
    setCrisisSeverityMut(ws, c1.id, -5)
    expect(ws.crises[c1.id]?.severity).toBe(0)
  })

  it('removeCrisisMut が crisis と全索引を除去する', () => {
    const ws = makeEmptyV016State()
    const c1 = createCrisisMut(ws, makeInput())
    const pid = 'pr-9' as ProjectId
    setCrisisResponseProjectMut(ws, c1.id, pid)
    removeCrisisMut(ws, c1.id)
    expect(ws.crises[c1.id]).toBeUndefined()
    expect(ws.crisisIndex.byHolding[HOLDING as string]).toBeUndefined()
    expect(ws.crisisIndex.byProject[pid]).toBeUndefined()
  })
})
