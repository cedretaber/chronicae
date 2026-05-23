import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopClass } from '../types/popGroup'
import type { HoldingId } from '../types/ids'
import { getPrimaryOccupationForClass } from '../types/popGroup'
import {
  getHoldingOccupationCapacity,
  getHoldingPopSizeByClassAndOccupation,
  getHoldingPopsByClassAndOccupation,
} from '../selectors/popSelectors'
import { movePopSizeToOccupationMut } from '../mutations/popMutations'

const POP_CLASSES: PopClass[] = ['peasants', 'townsmen', 'nobles']

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
      const primaryOccupation = getPrimaryOccupationForClass(popClass)

      // Phase 1: Forced unemployment — move excess employed POPs to none
      const capacity = getHoldingOccupationCapacity(
        ws,
        ctx.config,
        holding.id,
        popClass,
        primaryOccupation,
      )
      const currentEmployed = getHoldingPopSizeByClassAndOccupation(
        ws,
        holding.id,
        popClass,
        primaryOccupation,
      )

      if (currentEmployed > capacity) {
        const excess = currentEmployed - capacity
        const employedPops = getHoldingPopsByClassAndOccupation(
          ws,
          holding.id,
          popClass,
          primaryOccupation,
        )

        let remainingExcess = excess
        for (const pop of employedPops) {
          if (remainingExcess <= 0) break
          const moveAmount = Math.min(pop.size, remainingExcess)
          if (moveAmount <= 0) continue
          movePopSizeToOccupationMut(ws, {
            sourcePopId: pop.id,
            targetOccupation: 'none',
            size: moveAmount,
          })
          remainingExcess -= moveAmount
        }
      }

      // Phase 2: Re-employment — move none POPs back to primary occupation
      const nonePops = getHoldingPopsByClassAndOccupation(ws, holding.id, popClass, 'none')
      if (nonePops.length === 0) continue

      const remainingCapacity = getHoldingOccupationCapacity(
        ws,
        ctx.config,
        holding.id,
        popClass,
        primaryOccupation,
      )
      const currentAfterForced = getHoldingPopSizeByClassAndOccupation(
        ws,
        holding.id,
        popClass,
        primaryOccupation,
      )
      let room = Math.max(0, remainingCapacity - currentAfterForced)

      if (room <= 0) continue

      for (const nonePop of nonePops) {
        if (room <= 0) break
        // Re-read the pop from ws since mutations may have changed it
        const currentPop = ws.popGroups[nonePop.id]
        if (!currentPop || currentPop.occupation !== 'none') continue

        const moveAmount = Math.min(currentPop.size, room)
        if (moveAmount <= 0) continue
        movePopSizeToOccupationMut(ws, {
          sourcePopId: currentPop.id,
          targetOccupation: primaryOccupation,
          size: moveAmount,
        })
        room -= moveAmount
      }
    }
  }

  return { ...ctx, state: ws }
}
