import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { BattleLogId } from '../types/ids'
import type { BattleLog } from '../types/battleLog'

// v0.49 §15.6 cleanupBattleLogSystem
//
// 期限切れの `normal` BattleLog を削除する。
// - `importance === 'normal' && week + battleLogNormalRetentionWeeks < absoluteWeek` の BattleLog を削除
// - 削除時に battleLogIndex.byWar も purge する
// - `major` BattleLog は削除しない (恒久保存)
// - `minor` は compact BattleLog を作らないため (§15.6) 削除対象に現れない
//
// tick 実行順は cleanupWarSystem 近辺 (war 系 cleanup と同じ後段) に置く。

export function runCleanupBattleLogSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const absoluteWeek = ctx.state.absoluteWeek

  const toRemove: BattleLog[] = []
  for (const id of Object.keys(ctx.state.battleLogs)) {
    const log = ctx.state.battleLogs[id as BattleLogId]
    if (!log || log.importance !== 'normal') continue
    if (log.week + config.battleLogNormalRetentionWeeks < absoluteWeek) toRemove.push(log)
  }
  if (toRemove.length === 0) return ctx

  const ws: WorldState = {
    ...ctx.state,
    battleLogs: { ...ctx.state.battleLogs },
    battleLogIndex: { byWar: { ...ctx.state.battleLogIndex.byWar } },
  }
  for (const log of toRemove) {
    delete ws.battleLogs[log.id]
    const arr = ws.battleLogIndex.byWar[log.warId]
    if (arr) {
      const next = arr.filter((bid) => bid !== log.id)
      if (next.length === 0) delete ws.battleLogIndex.byWar[log.warId]
      else ws.battleLogIndex.byWar[log.warId] = next
    }
  }
  return { ...ctx, state: ws }
}
