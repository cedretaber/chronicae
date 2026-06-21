import type { TickContext } from './context'
import type { LandContractDefaultId } from '../types/ids'
import { resolveLandContractDefaultState } from '../mutations/landContractDefaultMutations'

// active な LandContractDefault の targetLandContractId が contract eliminate (Project 完了の
//   consolidation / peace settlement / polityOwnerConsistency 等) で同 tick に消えると、active default が
//   存在しない契約を指して dangling 化し年末 integrity を踏む (active のみ FK 検査・terminal は dangling 許容)。
//   cancelOrphanedPlays (DiplomaticPlay 版) / staleWarGoalSweepSystem (WarGoal 版) と同型の
//   「アンカー契約が消えた義務 entity を年末 integrity 前に terminal 化する」weekly sweep でこれを解消する。
//   resolveLandContractDefaultState が status を resolved にし関連 Pressure も掃除するため、terminal 化後は
//   active-only FK 検査をパスし dangling Pressure も残さない。RNG 非消費・決定論 (sorted iteration)。
export function cancelOrphanedLandContractDefaults(ctx: TickContext): TickContext {
  const orphaned: LandContractDefaultId[] = []
  for (const idStr of Object.keys(ctx.state.landContractDefaults).sort()) {
    const d = ctx.state.landContractDefaults[idStr as LandContractDefaultId]
    if (!d || d.status !== 'active') continue
    if (!ctx.state.landContracts[d.targetLandContractId]) orphaned.push(d.id)
  }
  if (orphaned.length === 0) return ctx

  let state = ctx.state
  for (const id of orphaned) {
    state = resolveLandContractDefaultState(state, id)
  }
  return { ...ctx, state }
}
