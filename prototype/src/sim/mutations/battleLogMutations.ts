// v0.49 §15 BattleLog mutation。後年参照用の恒久戦場ログを WorldState に追加する。
//   Battle entity (短期) と異なり war cleanup で消えず、cleanupBattleLogSystem が importance retention で purge する。

import type { WorldState } from '../types/world'
import type {
  BattleLog,
  BattleTickLog,
  BattleLogImportance,
  BattleDestroyedCause,
} from '../types/battleLog'
import type {
  WarId,
  BattleId,
  ProvinceId,
  HoldingId,
  PersonId,
  ChronicleEntryId,
} from '../types/ids'
import type { BattlefieldKind, BattleResult, WarSideKey } from '../types/war'
import type { BattleOutcomeQuality, BattleCommanderAssignment } from '../types/battle'
import { createBattleLogId } from '../types/ids'

export type CreateBattleLogInput = {
  warId: WarId
  battleId?: BattleId
  week: number
  provinceId: ProvinceId
  holdingId?: HoldingId
  battlefieldKind: BattlefieldKind
  baseFrontage: number
  effectiveFrontage: number
  result: BattleResult
  outcomeQuality?: BattleOutcomeQuality
  importance: BattleLogImportance
  attackerCaptainGeneralPersonId?: PersonId
  defenderCaptainGeneralPersonId?: PersonId
  attackerCommanders?: BattleCommanderAssignment[]
  defenderCommanders?: BattleCommanderAssignment[]
  tickLogs: BattleTickLog[]
  majorChronicleRefs?: ChronicleEntryId[]
}

// §15.6 importance 判定が読む最小構造 (BattleSimResult のサブセット)。
export type BattleLogImportanceInput = {
  breakthroughSide?: WarSideKey
  outcomeQuality: BattleOutcomeQuality
  result: BattleResult
  regimentResults: ReadonlyArray<{ destroyedCause?: BattleDestroyedCause }>
}

// §15.6 importance 判定。breakthrough / pursuit-destroyed / decisive (rout) は major、
//   勝者が明確な通常会戦は normal、inconclusive / 重要イベントなしは minor。
//   minor は BattleLog を作らない (caller が判定して skip)。
export function battleLogImportance(sim: BattleLogImportanceInput): BattleLogImportance {
  const hasBreakthrough = sim.breakthroughSide !== undefined
  const hasPursuitDestroyed = sim.regimentResults.some(
    (rr) => rr.destroyedCause === 'pursuit' || rr.destroyedCause === 'breakthrough_pursuit',
  )
  const decisive = sim.outcomeQuality === 'rout'
  if (hasBreakthrough || hasPursuitDestroyed || decisive) return 'major'
  if (sim.result !== 'inconclusive') return 'normal'
  return 'minor'
}

export function createBattleLogMut(ws: WorldState, input: CreateBattleLogInput): BattleLog {
  const id = createBattleLogId(ws.nextBattleLogId)
  ws.nextBattleLogId++
  const log: BattleLog = {
    id,
    warId: input.warId,
    week: input.week,
    provinceId: input.provinceId,
    battlefieldKind: input.battlefieldKind,
    baseFrontage: input.baseFrontage,
    effectiveFrontage: input.effectiveFrontage,
    result: input.result,
    importance: input.importance,
    tickLogs: input.tickLogs,
    ...(input.battleId !== undefined ? { battleId: input.battleId } : {}),
    ...(input.holdingId !== undefined ? { holdingId: input.holdingId } : {}),
    ...(input.outcomeQuality !== undefined ? { outcomeQuality: input.outcomeQuality } : {}),
    ...(input.attackerCaptainGeneralPersonId !== undefined
      ? { attackerCaptainGeneralPersonId: input.attackerCaptainGeneralPersonId }
      : {}),
    ...(input.defenderCaptainGeneralPersonId !== undefined
      ? { defenderCaptainGeneralPersonId: input.defenderCaptainGeneralPersonId }
      : {}),
    ...(input.attackerCommanders !== undefined
      ? { attackerCommanders: input.attackerCommanders }
      : {}),
    ...(input.defenderCommanders !== undefined
      ? { defenderCommanders: input.defenderCommanders }
      : {}),
    ...(input.majorChronicleRefs !== undefined
      ? { majorChronicleRefs: input.majorChronicleRefs }
      : {}),
  }
  ws.battleLogs[id] = log
  // byWar 内側配列は前 state と共有されうる (runWarManeuverSystem は byWar マップを浅クローン
  //   するのみ) ので copy-on-write で追加する。battleMutations.createBattle と同じ規約。
  ws.battleLogIndex.byWar[input.warId] = [...(ws.battleLogIndex.byWar[input.warId] ?? []), id]
  return log
}
