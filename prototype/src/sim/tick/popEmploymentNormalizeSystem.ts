import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { HoldingId } from '../types/ids'
import { normalizePopEmploymentMut } from './employmentRebalanceSystem'

// v0.56 §9: 転職・移住後の保険的な雇用整合。mobility は live capacity を尊重するため通常は
//   冪等だが、capacity 超過が残らないことを保証する。EmploymentRebalance と同じ holding 単位
//   helper を全 holding に再適用する (B1 の demand-aware 再雇用も共有)。
export function runPopEmploymentNormalizeSystem(ctx: TickContext): TickContext {
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
