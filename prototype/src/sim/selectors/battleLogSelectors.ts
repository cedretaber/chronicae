import type { WorldState } from '../types/world'
import type { BattleLog } from '../types/battleLog'
import type { WarId } from '../types/ids'

// 会戦再生 UI 用: ある War の恒久 BattleLog を battleLogIndex.byWar 経由で解決し、新しい順 (week 降順) に返す。
//   noUncheckedIndexedAccess 下で欠損 id を除外する。
export function getBattleLogsForWar(state: WorldState, warId: WarId): BattleLog[] {
  const ids = state.battleLogIndex.byWar[warId] ?? []
  return ids
    .map((id) => state.battleLogs[id])
    .filter((log): log is BattleLog => log !== undefined)
    .sort((a, b) => b.week - a.week)
}

// 会戦一覧の一行サマリ用: tickLogs を走査して突破/追撃/壊滅イベント数を数える。
export interface BattleEventSummary {
  breakthrough: number
  pursuit: number
  destroyed: number
}

export function summarizeBattleEvents(log: BattleLog): BattleEventSummary {
  const summary: BattleEventSummary = { breakthrough: 0, pursuit: 0, destroyed: 0 }
  for (const tl of log.tickLogs) {
    for (const ev of tl.events) {
      if (ev.kind === 'breakthrough' || ev.kind === 'cavalry_charge') summary.breakthrough++
      else if (ev.kind === 'pursuit' || ev.kind === 'cavalry_pursuit') summary.pursuit++
      else if (ev.kind === 'regiment_destroyed') summary.destroyed++
    }
  }
  return summary
}
