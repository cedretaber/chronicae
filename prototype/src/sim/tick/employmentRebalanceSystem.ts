import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PopType } from '../types/popGroup'
import { POP_TYPES } from '../types/popGroup'
import type { HoldingId } from '../types/ids'
import {
  getHoldingAllPopTypeCapacities,
  getHoldingEmployedPopSizeByType,
  getHoldingPopsByTypeAndEmployment,
  clampCapacityByMaxRatio,
} from '../selectors/popSelectors'
import { POP_TYPE_MAX_RATIO } from '../config/realEstateDefinitions'
import { movePopEmploymentMut } from '../mutations/popMutations'

// v0.57 §雇用細分化: rebalance の PopType 処理順。同数上限を持つ熟練職 (親方/自作農) は
//   参照先 (職人/小作農) の雇用が確定した後に処理する必要があるため最後に回す。
const REBALANCE_ORDER: PopType[] = [
  ...POP_TYPES.filter((t) => !POP_TYPE_MAX_RATIO[t]),
  ...POP_TYPES.filter((t) => POP_TYPE_MAX_RATIO[t]),
]

// v0.57 §雇用細分化: holding 単位の雇用整合 helper (PopType ハード枠)。
//   各 PopType について Phase1: capacity 超過の employed を unemployed へ、
//   Phase2: 空き枠を同 PopType の unemployed で埋める。
//   熟練職は同数上限 (POP_TYPE_MAX_RATIO) を参照先の実雇用数 × ratio で動的にキャップする。
//   ws を in-place 変異する (呼び出し側が draft を用意する規約)。
export function normalizePopEmploymentMut(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): void {
  const holding = ws.holdings[holdingId]
  if (!holding) return

  const capByType = getHoldingAllPopTypeCapacities(ws, config, holdingId)

  for (const popType of REBALANCE_ORDER) {
    // 同数上限: 参照先 (職人/小作農) の現在の実雇用数 × ratio で上限を絞る (共有 helper)。
    //   REBALANCE_ORDER で参照先を先に確定するため、ここで読む refEmployed は確定後の値。
    const cap = clampCapacityByMaxRatio(ws, holdingId, popType, capByType[popType] ?? 0)

    // Phase 1: Forced unemployment — capacity 超過の employed を unemployed へ。
    const currentEmployed = getHoldingEmployedPopSizeByType(ws, holdingId, popType)
    if (currentEmployed > cap) {
      let remainingExcess = currentEmployed - cap
      for (const pop of getHoldingPopsByTypeAndEmployment(ws, holdingId, popType, true)) {
        if (remainingExcess <= 0) break
        const moveAmount = Math.min(pop.size, remainingExcess)
        if (moveAmount <= 0) continue
        movePopEmploymentMut(ws, { sourcePopId: pop.id, targetEmployed: false, size: moveAmount })
        remainingExcess -= moveAmount
      }
    }

    // Phase 2: Re-employment — 空き枠を同 PopType の unemployed で埋める。
    const afterForced = getHoldingEmployedPopSizeByType(ws, holdingId, popType)
    let room = Math.max(0, cap - afterForced)
    if (room <= 0) continue
    for (const uPop of getHoldingPopsByTypeAndEmployment(ws, holdingId, popType, false)) {
      if (room <= 0) break
      const currentPop = ws.popGroups[uPop.id]
      if (!currentPop || currentPop.employed) continue
      const moveAmount = Math.min(currentPop.size, room)
      if (moveAmount <= 0) continue
      movePopEmploymentMut(ws, {
        sourcePopId: currentPop.id,
        targetEmployed: true,
        size: moveAmount,
      })
      room -= moveAmount
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
