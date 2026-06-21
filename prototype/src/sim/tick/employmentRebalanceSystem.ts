import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PopClass, PopGroup } from '../types/popGroup'
import type { HoldingId } from '../types/ids'
import {
  getHoldingClassCapacity,
  getHoldingEmployedPopSize,
  getHoldingPopsByClassAndEmployment,
} from '../selectors/popSelectors'
import { computeHoldingPopTypeDemand } from '../selectors/popMobilitySelectors'
import { movePopEmploymentMut } from '../mutations/popMutations'

const POP_CLASSES: PopClass[] = ['lower', 'middle', 'upper']

// v0.56 §9: holding 単位の雇用整合 helper。EmploymentRebalanceSystem 本体と mobility 後の
//   normalize で共有する。ws を in-place 変異する (呼び出し側が draft を用意する規約)。
//   Phase1: capacity 超過の employed を unemployed へ。Phase2: 空き枠を unemployed で埋める。
//   B1: Phase2 の再雇用は shortage の大きい PopType を優先する (popType 盲目の遠回りを避ける)。
export function normalizePopEmploymentMut(
  ws: WorldState,
  config: SimulationConfig,
  holdingId: HoldingId,
): void {
  const holding = ws.holdings[holdingId]
  if (!holding) return

  // B1 用 shortage は normalize 開始時点の値を使う (決定論・cheap。Phase2 の順序付けにのみ使用)。
  const demand = computeHoldingPopTypeDemand(ws, config, holdingId)

  for (const popClass of POP_CLASSES) {
    // Phase 1: Forced unemployment — move excess employed POPs to unemployed
    const capacity = getHoldingClassCapacity(ws, config, holdingId, popClass)
    const currentEmployed = getHoldingEmployedPopSize(ws, holdingId, popClass)

    if (currentEmployed > capacity) {
      const excess = currentEmployed - capacity
      const employedPops = getHoldingPopsByClassAndEmployment(ws, holdingId, popClass, true)

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

    // Phase 2: Re-employment — move unemployed POPs back to employed (demand-aware, B1)
    const unemployedPops = getHoldingPopsByClassAndEmployment(ws, holdingId, popClass, false)
    if (unemployedPops.length === 0) continue

    const remainingCapacity = getHoldingClassCapacity(ws, config, holdingId, popClass)
    const currentAfterForced = getHoldingEmployedPopSize(ws, holdingId, popClass)
    let room = Math.max(0, remainingCapacity - currentAfterForced)

    if (room <= 0) continue

    for (const uPop of orderUnemployedByShortage(unemployedPops, demand)) {
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

// B1: shortage 降順、tie-break は PopGroupId 昇順 (決定論)。
function orderUnemployedByShortage(
  pops: PopGroup[],
  demand: ReturnType<typeof computeHoldingPopTypeDemand>,
): PopGroup[] {
  return [...pops].sort((a, b) => {
    const sa = demand.shortageByType[a.popType] ?? 0
    const sb = demand.shortageByType[b.popType] ?? 0
    if (sb !== sa) return sb - sa
    const ia = a.id as string
    const ib = b.id as string
    return ia < ib ? -1 : ia > ib ? 1 : 0
  })
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
