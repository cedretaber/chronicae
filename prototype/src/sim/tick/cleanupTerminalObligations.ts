import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import { removeRealEstateSeizureMut } from '../mutations/realEstateSeizureMutations'

// v0.53 §6.2 (B7): terminal (resolved/legalized/cancelled) 化した義務 entity を
//   terminalObligationRetentionWeeks 経過後に Record から削除する。index は terminal 化時に
//   既に除去済み (active のみ index 保持)。retention 中は UI / Event 参照のために Record に残す。
export function runCleanupTerminalObligations(ctx: TickContext): TickContext {
  const retention = ctx.config.terminalObligationRetentionWeeks
  const absoluteWeek = ctx.state.absoluteWeek

  const toRemove: import('../types/ids').RealEstateSeizureId[] = []
  for (const [, seizure] of Object.entries(ctx.state.realEstateSeizures)) {
    if (!seizure || seizure.status === 'active') continue
    const terminalWeek = seizure.terminalWeek ?? seizure.startedWeek
    if (absoluteWeek - terminalWeek >= retention) toRemove.push(seizure.id)
  }
  if (toRemove.length === 0) return ctx

  const ws: WorldState = {
    ...ctx.state,
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
    realEstateSeizureIndex: {
      byHolding: { ...ctx.state.realEstateSeizureIndex.byHolding },
      byAsset: { ...ctx.state.realEstateSeizureIndex.byAsset },
      byRightfulOwnerHouse: { ...ctx.state.realEstateSeizureIndex.byRightfulOwnerHouse },
    },
  }
  for (const id of toRemove) {
    removeRealEstateSeizureMut(ws, id)
  }
  return { ...ctx, state: ws }
}
