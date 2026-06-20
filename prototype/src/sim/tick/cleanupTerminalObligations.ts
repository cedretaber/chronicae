import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { RealEstateSeizureId, LandContractDefaultId } from '../types/ids'
import { removeRealEstateSeizureMut } from '../mutations/realEstateSeizureMutations'
import { removeLandContractDefaultMut } from '../mutations/landContractDefaultMutations'

// v0.53 §6.2 (B7): terminal (resolved/legalized/cancelled) 化した義務 entity を
//   terminalObligationRetentionWeeks 経過後に Record から削除する。index は terminal 化時に
//   既に除去済み (active のみ index 保持)。retention 中は UI / Event 参照のために Record に残す。
export function runCleanupTerminalObligations(ctx: TickContext): TickContext {
  const retention = ctx.config.terminalObligationRetentionWeeks
  const absoluteWeek = ctx.state.absoluteWeek

  const seizuresToRemove: RealEstateSeizureId[] = []
  for (const [, seizure] of Object.entries(ctx.state.realEstateSeizures)) {
    if (!seizure || seizure.status === 'active') continue
    const terminalWeek = seizure.terminalWeek ?? seizure.startedWeek
    if (absoluteWeek - terminalWeek >= retention) seizuresToRemove.push(seizure.id)
  }
  const defaultsToRemove: LandContractDefaultId[] = []
  for (const [, d] of Object.entries(ctx.state.landContractDefaults)) {
    if (!d || d.status === 'active') continue
    const terminalWeek = d.terminalWeek ?? d.startedWeek
    if (absoluteWeek - terminalWeek >= retention) defaultsToRemove.push(d.id)
  }
  if (seizuresToRemove.length === 0 && defaultsToRemove.length === 0) return ctx

  const ws: WorldState = {
    ...ctx.state,
    realEstateSeizures: { ...ctx.state.realEstateSeizures },
    realEstateSeizureIndex: {
      byHolding: { ...ctx.state.realEstateSeizureIndex.byHolding },
      byAsset: { ...ctx.state.realEstateSeizureIndex.byAsset },
      byRightfulOwnerHouse: { ...ctx.state.realEstateSeizureIndex.byRightfulOwnerHouse },
    },
    landContractDefaults: { ...ctx.state.landContractDefaults },
    landContractDefaultIndex: {
      byHolding: { ...ctx.state.landContractDefaultIndex.byHolding },
      byContract: { ...ctx.state.landContractDefaultIndex.byContract },
      byClaimantPolity: { ...ctx.state.landContractDefaultIndex.byClaimantPolity },
      byOccupierPolity: { ...ctx.state.landContractDefaultIndex.byOccupierPolity },
    },
  }
  for (const id of seizuresToRemove) removeRealEstateSeizureMut(ws, id)
  for (const id of defaultsToRemove) removeLandContractDefaultMut(ws, id)
  return { ...ctx, state: ws }
}
