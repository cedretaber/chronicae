import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PopType } from '../types/popGroup'
import { POP_TYPES } from '../types/popGroup'
import type { HoldingId } from '../types/ids'
import {
  collectHoldingWorkplaces,
  getWorkplacePopTypeCapacity,
  buildHoldingEmploymentMap,
  empMapLookup,
  empMapUpdate,
  type HoldingEmploymentMap,
} from '../selectors/popSelectors'
import { POP_TYPE_MAX_RATIO } from '../config/realEstateDefinitions'
import { movePopEmploymentMut } from '../mutations/popMutations'
import type { WorkplaceRef } from '../types/workplaceRef'
import { workplaceRefKey } from '../types/workplaceRef'

const REBALANCE_ORDER: PopType[] = [
  ...POP_TYPES.filter((t) => !POP_TYPE_MAX_RATIO[t]),
  ...POP_TYPES.filter((t) => POP_TYPE_MAX_RATIO[t]),
]

function clampCapacityByMaxRatioFromMap(
  empMap: HoldingEmploymentMap,
  ref: WorkplaceRef,
  popType: PopType,
  rawCapacity: number,
): number {
  const maxRatio = POP_TYPE_MAX_RATIO[popType]
  if (!maxRatio) return rawCapacity
  const refEmployed = empMapLookup(empMap, ref, maxRatio.popType)
  return Math.min(rawCapacity, refEmployed * maxRatio.ratio)
}

export function normalizePopEmploymentMut(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): HoldingEmploymentMap | undefined {
  const holding = ws.holdings[holdingId]
  if (!holding) return undefined

  const workplaces = collectHoldingWorkplaces(ws, config, holdingId)
  const workplaceKeySet = new Set(workplaces.map(workplaceRefKey))

  const empMap = buildHoldingEmploymentMap(ws, holdingId)

  const vanishedEmployers: WorkplaceRef[] = []
  const seenVanishedKeys = new Set<string>()
  for (const popId of (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()) {
    const pop = ws.popGroups[popId]
    if (!pop || pop.employerId === null) continue
    const key = workplaceRefKey(pop.employerId)
    if (!workplaceKeySet.has(key) && !seenVanishedKeys.has(key)) {
      vanishedEmployers.push(pop.employerId)
      seenVanishedKeys.add(key)
    }
  }

  // Phase 1: capacity 超過 / 消失 employer → unemployed
  const phase1Refs = [...vanishedEmployers, ...workplaces].sort((a, b) => {
    const ka = workplaceRefKey(a)
    const kb = workplaceRefKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  for (const ref of phase1Refs) {
    const isVanished = !workplaceKeySet.has(workplaceRefKey(ref))
    const refKey = workplaceRefKey(ref)
    for (const popType of REBALANCE_ORDER) {
      const rawCapacity = isVanished ? 0 : getWorkplacePopTypeCapacity(ws, config, ref, popType)
      const capacity = clampCapacityByMaxRatioFromMap(empMap, ref, popType, rawCapacity)
      const employed = empMapLookup(empMap, ref, popType)
      if (employed <= capacity) continue
      let excess = employed - capacity
      const sortedPopIds = (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()
      for (const popId of sortedPopIds) {
        if (excess <= 0) break
        const pop = ws.popGroups[popId]
        if (
          !pop ||
          pop.popType !== popType ||
          pop.employerId === null ||
          workplaceRefKey(pop.employerId) !== refKey
        )
          continue
        const moveSize = Math.min(pop.size, excess)
        if (moveSize <= 0) continue
        movePopEmploymentMut(ws, { sourcePopId: pop.id, targetEmployerId: null, size: moveSize })
        empMapUpdate(empMap, popType, pop.employerId, null, moveSize)
        excess -= moveSize
      }
    }
  }

  // Phase 2: 空き枠 → unemployed POP を employer に紐付け
  for (const ref of workplaces) {
    for (const popType of REBALANCE_ORDER) {
      const rawCapacity = getWorkplacePopTypeCapacity(ws, config, ref, popType)
      const capacity = clampCapacityByMaxRatioFromMap(empMap, ref, popType, rawCapacity)
      const employed = empMapLookup(empMap, ref, popType)
      let room = Math.max(0, capacity - employed)
      if (room <= 0) continue
      const sortedPopIds = (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()
      for (const popId of sortedPopIds) {
        if (room <= 0) break
        const pop = ws.popGroups[popId]
        if (!pop || pop.popType !== popType || pop.employerId !== null) continue
        const moveSize = Math.min(pop.size, room)
        if (moveSize <= 0) continue
        movePopEmploymentMut(ws, { sourcePopId: pop.id, targetEmployerId: ref, size: moveSize })
        empMapUpdate(empMap, popType, null, ref, moveSize)
        room -= moveSize
      }
    }
  }

  return empMap
}

// employer 間按分 — 同 PopType の雇用者を capacity 比で再分配する。
function redistributeEmploymentMut(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
  empMap: HoldingEmploymentMap,
): void {
  const workplaces = collectHoldingWorkplaces(ws, config, holdingId)
  if (workplaces.length < 2) return

  for (const popType of REBALANCE_ORDER) {
    const wpData: { ref: WorkplaceRef; key: string; cap: number; emp: number }[] = []
    for (const ref of workplaces) {
      const rawCap = getWorkplacePopTypeCapacity(ws, config, ref, popType)
      const cap = clampCapacityByMaxRatioFromMap(empMap, ref, popType, rawCap)
      if (cap <= 0) continue
      const key = workplaceRefKey(ref)
      const emp = empMapLookup(empMap, ref, popType)
      wpData.push({ ref, key, cap, emp })
    }
    if (wpData.length <= 1) continue

    const totalCap = wpData.reduce((s, w) => s + w.cap, 0)
    if (totalCap <= 0) continue
    const totalEmp = wpData.reduce((s, w) => s + w.emp, 0)
    if (totalEmp <= 0) continue

    let needsRedist = false
    for (const w of wpData) {
      if (Math.abs(w.emp - totalEmp * (w.cap / totalCap)) > 0.01) {
        needsRedist = true
        break
      }
    }
    if (!needsRedist) continue

    // Phase 3a: 超過分を失業させる
    const sortedPopIds = (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()
    for (const w of wpData) {
      let excess = w.emp - totalEmp * (w.cap / totalCap)
      if (excess <= 0.01) continue
      for (const popId of sortedPopIds) {
        if (excess <= 0) break
        const pop = ws.popGroups[popId]
        if (
          !pop ||
          pop.popType !== popType ||
          pop.employerId === null ||
          workplaceRefKey(pop.employerId) !== w.key
        )
          continue
        const moveSize = Math.min(pop.size, excess)
        if (moveSize <= 0) continue
        movePopEmploymentMut(ws, { sourcePopId: pop.id, targetEmployerId: null, size: moveSize })
        empMapUpdate(empMap, popType, pop.employerId, null, moveSize)
        excess -= moveSize
      }
    }

    // Phase 3b: 不足分を充填
    const sortedPopIds2 = (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()
    for (const w of wpData) {
      const employed = empMapLookup(empMap, w.ref, popType)
      let deficit = totalEmp * (w.cap / totalCap) - employed
      if (deficit <= 0.01) continue
      for (const popId of sortedPopIds2) {
        if (deficit <= 0) break
        const pop = ws.popGroups[popId]
        if (!pop || pop.popType !== popType || pop.employerId !== null) continue
        const moveSize = Math.min(pop.size, deficit)
        if (moveSize <= 0) continue
        movePopEmploymentMut(ws, { sourcePopId: pop.id, targetEmployerId: w.ref, size: moveSize })
        empMapUpdate(empMap, popType, null, w.ref, moveSize)
        deficit -= moveSize
      }
    }
  }
}

export function runEmploymentRebalanceSystem(ctx: TickContext): TickContext {
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  for (const holdingId of Object.keys(ws.holdings).sort() as HoldingId[]) {
    const empMap = normalizePopEmploymentMut(ws, ctx.config, holdingId)
    if (empMap) {
      redistributeEmploymentMut(ws, ctx.config, holdingId, empMap)
    }
  }

  return { ...ctx, state: ws }
}
