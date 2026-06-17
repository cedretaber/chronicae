import type { WorldState } from '../types/world'
import type { BattleLog } from '../types/battleLog'
import type { WarId } from '../types/ids'

// 会戦再生 UI 用: ある War の恒久 BattleLog を battleLogIndex.byWar 経由で解決し、新しい順 (week 降順) に返す。
//   chronicleSelectors.resolveChronicleEntries と同じく noUncheckedIndexedAccess 下で欠損 id を除外する。
export function getBattleLogsForWar(state: WorldState, warId: WarId): BattleLog[] {
  const ids = state.battleLogIndex.byWar[warId] ?? []
  return ids
    .map((id) => state.battleLogs[id])
    .filter((log): log is BattleLog => log !== undefined)
    .sort((a, b) => b.week - a.week)
}
