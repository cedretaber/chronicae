import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PopType } from '../types/popGroup'
import { POP_TYPES } from '../types/popGroup'
import type { HoldingId } from '../types/ids'
import {
  collectHoldingWorkplaces,
  getWorkplacePopTypeCapacity,
  getWorkplaceEmployedPopSizeByType,
} from '../selectors/popSelectors'
import { POP_TYPE_MAX_RATIO } from '../config/realEstateDefinitions'
import { movePopEmploymentMut } from '../mutations/popMutations'
import type { WorkplaceRef } from '../types/workplaceRef'
import { workplaceRefKey } from '../types/workplaceRef'

// v0.57 §雇用細分化: rebalance の PopType 処理順。同数上限を持つ熟練職 (親方/自作農) は
//   参照先 (職人/小作農) の雇用が確定した後に処理する必要があるため最後に回す。
const REBALANCE_ORDER: PopType[] = [
  ...POP_TYPES.filter((t) => !POP_TYPE_MAX_RATIO[t]),
  ...POP_TYPES.filter((t) => POP_TYPE_MAX_RATIO[t]),
]

// per-employer 版の maxRatio クランプ。
//   REBALANCE_ORDER で参照先 (peasants/artisans) を先に確定するため、
//   ここで読む refEmployed は当該 employer での確定済み雇用数。
function clampCapacityByMaxRatioPerEmployer(
  ws: WorldState,
  holdingId: HoldingId,
  ref: WorkplaceRef,
  popType: PopType,
  rawCapacity: number,
): number {
  const maxRatio = POP_TYPE_MAX_RATIO[popType]
  if (!maxRatio) return rawCapacity
  const refEmployed = getWorkplaceEmployedPopSizeByType(ws, holdingId, ref, maxRatio.popType)
  return Math.min(rawCapacity, refEmployed * maxRatio.ratio)
}

// v0.63 Task 4: employer (WorkplaceRef) 単位の雇用整合 helper。
//   Phase 1: 消失した employer / capacity 超過の employed を unemployed (null) へ強制移動。
//   Phase 2: 空き枠を同 PopType の unemployed で埋め、各 employer ref に紐付ける。
//   ws を in-place 変異する (呼び出し側が draft を用意する規約)。
export function normalizePopEmploymentMut(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): void {
  const holding = ws.holdings[holdingId]
  if (!holding) return

  // Step 1: 現存する workplace refs を収集 (workplaceRefKey でソート済み)。
  const workplaces = collectHoldingWorkplaces(ws, config, holdingId)
  const workplaceKeySet = new Set(workplaces.map(workplaceRefKey))

  // Step 2: 消失した employer (POP が参照するが workplaces に存在しない) を特定する。
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

  // Phase 1: 容量超過 / 消失 employer の POP を強制失業させる。
  //   vanished employers は capacity=0 として扱い全員失業。
  //   REBALANCE_ORDER (maxRatio 参照先を先) で処理するため、クランプの参照値は確定後の値。
  const phase1Refs = [...vanishedEmployers, ...workplaces].sort((a, b) => {
    const ka = workplaceRefKey(a)
    const kb = workplaceRefKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  for (const ref of phase1Refs) {
    const isVanished = !workplaceKeySet.has(workplaceRefKey(ref))
    for (const popType of REBALANCE_ORDER) {
      const rawCapacity = isVanished ? 0 : getWorkplacePopTypeCapacity(ws, config, ref, popType)
      const capacity = clampCapacityByMaxRatioPerEmployer(ws, holdingId, ref, popType, rawCapacity)
      const employed = getWorkplaceEmployedPopSizeByType(ws, holdingId, ref, popType)
      if (employed <= capacity) continue
      let excess = employed - capacity
      const refKey = workplaceRefKey(ref)
      for (const popId of (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()) {
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
        excess -= moveSize
      }
    }
  }

  // Phase 2: 空き枠を同 PopType の失業 POP で埋め、具体的な employer ref に紐付ける。
  for (const ref of workplaces) {
    for (const popType of REBALANCE_ORDER) {
      const rawCapacity = getWorkplacePopTypeCapacity(ws, config, ref, popType)
      const capacity = clampCapacityByMaxRatioPerEmployer(ws, holdingId, ref, popType, rawCapacity)
      const employed = getWorkplaceEmployedPopSizeByType(ws, holdingId, ref, popType)
      let room = Math.max(0, capacity - employed)
      if (room <= 0) continue
      for (const popId of (ws.popIndex.byHolding[holdingId] ?? []).slice().sort()) {
        if (room <= 0) break
        const pop = ws.popGroups[popId]
        if (!pop || pop.popType !== popType || pop.employerId !== null) continue
        const moveSize = Math.min(pop.size, room)
        if (moveSize <= 0) continue
        movePopEmploymentMut(ws, { sourcePopId: pop.id, targetEmployerId: ref, size: moveSize })
        room -= moveSize
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
    normalizePopEmploymentMut(ws, ctx.config, holdingId)
  }

  return { ...ctx, state: ws }
}
