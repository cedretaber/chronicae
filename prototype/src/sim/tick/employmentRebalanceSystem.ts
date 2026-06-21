import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopClass } from '../types/popGroup'
import type { HoldingId } from '../types/ids'
import {
  getHoldingClassCapacity,
  getHoldingEmployedPopSize,
  getHoldingPopsByClassAndEmployment,
} from '../selectors/popSelectors'
import { movePopEmploymentMut } from '../mutations/popMutations'

const POP_CLASSES: PopClass[] = ['lower', 'middle', 'upper']

export function runEmploymentRebalanceSystem(ctx: TickContext): TickContext {
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  for (const holdingId of Object.keys(ws.holdings).sort() as HoldingId[]) {
    const holding = ws.holdings[holdingId]
    if (!holding) continue

    for (const popClass of POP_CLASSES) {
      // Phase 1: Forced unemployment — move excess employed POPs to unemployed
      const capacity = getHoldingClassCapacity(ws, ctx.config, holding.id, popClass)
      const currentEmployed = getHoldingEmployedPopSize(ws, holding.id, popClass)

      if (currentEmployed > capacity) {
        const excess = currentEmployed - capacity
        const employedPops = getHoldingPopsByClassAndEmployment(ws, holding.id, popClass, true)

        let remainingExcess = excess
        for (const pop of employedPops) {
          if (remainingExcess <= 0) break
          const moveAmount = Math.min(pop.size, remainingExcess)
          if (moveAmount <= 0) continue
          movePopEmploymentMut(ws, {
            sourcePopId: pop.id,
            targetEmployed: false,
            size: moveAmount,
          })
          remainingExcess -= moveAmount
        }
      }

      // Phase 2: Re-employment — move unemployed POPs back to employed
      const unemployedPops = getHoldingPopsByClassAndEmployment(ws, holding.id, popClass, false)
      if (unemployedPops.length === 0) continue

      const remainingCapacity = getHoldingClassCapacity(ws, ctx.config, holding.id, popClass)
      const currentAfterForced = getHoldingEmployedPopSize(ws, holding.id, popClass)
      let room = Math.max(0, remainingCapacity - currentAfterForced)

      if (room <= 0) continue

      for (const uPop of unemployedPops) {
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

  return { ...ctx, state: ws }
}
