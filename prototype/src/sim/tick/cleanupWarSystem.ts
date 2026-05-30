import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { WarId } from '../types/ids'
import type { War } from '../types/war'
import { removeWarFromIndexMut } from '../mutations/warMutations'

// v0.34 §9 cleanupWarSystem
//
// terminal War (active 以外) が endedWeek から terminalWarRetentionWeeks 経過したら
// records / warIndex から削除する。Event log に履歴が残るため長期保持は不要 (§9.1)。

export function runCleanupWarSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  const toRemove: War[] = []
  for (const id of Object.keys(ctx.state.wars)) {
    const w = ctx.state.wars[id as WarId]
    if (!w || w.status === 'active' || w.endedWeek === undefined) continue
    if (absoluteWeek - w.endedWeek >= config.terminalWarRetentionWeeks) toRemove.push(w)
  }
  if (toRemove.length === 0) return ctx

  const ws: WorldState = {
    ...ctx.state,
    wars: { ...ctx.state.wars },
    warIndex: {
      byParticipant: { ...ctx.state.warIndex.byParticipant },
      byOriginDiplomaticPlay: { ...ctx.state.warIndex.byOriginDiplomaticPlay },
    },
    // v0.36 §7.3: terminal War 削除に Battle cleanup を piggyback する (短期 entity)。
    battles: { ...ctx.state.battles },
    battleIndex: { byWar: { ...ctx.state.battleIndex.byWar } },
  }
  for (const w of toRemove) {
    delete ws.wars[w.id]
    removeWarFromIndexMut(ws, w)
    // v0.36 §7.3: この War に紐づく Battle を削除し byWar index を purge する。
    const battleIds = ws.battleIndex.byWar[w.id]
    if (battleIds) {
      for (const bid of battleIds) delete ws.battles[bid]
      delete ws.battleIndex.byWar[w.id]
    }
  }
  return { ...ctx, state: ws }
}
