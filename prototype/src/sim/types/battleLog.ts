// v0.49 会戦強化 — 戦場ログ・戦列スロットモデルの型定義 (docs/drafts/spec-v049-update.md §6,§7.2,§10.1,§15)
//
// BattleRegimentState / BattleLine は simulateBattle 実行中のみ存在し WorldState には残らない
// (§21.A: integrity では検査できず unit test / runtime assert で担保)。
// BattleLog / BattleTickLog / BattleLogEntry は後年参照用の恒久履歴として WorldState に保持する。

import type {
  RegimentId,
  WarId,
  BattleId,
  ProvinceId,
  HoldingId,
  PersonId,
  ChronicleEntryId,
  BattleLogId,
} from './ids'
import type { WarSideKey, BattlefieldKind, BattleResult } from './war'
import type { RegimentTroopKind } from './regiment'
import type { BattleOutcomeQuality } from './battle'

// §6.1 BattleRegimentState — 戦闘内部の連隊状態 (現行の非 export 内部型 WorkRegiment の改名/拡張)。
//   strength は snapshot で tick 中は mutate しない (§14.1)。
export type BattleRegimentState = {
  regimentId: RegimentId
  side: WarSideKey
  troopKind: RegimentTroopKind
  strength: number
  organization: number
  morale: number
  accumulatedOrgDamage: number
  routed: boolean
  retreated: boolean // org <= retreatThreshold で離脱 (rout ではない)
  wasInitialFrontline: boolean
  commanderPersonId?: PersonId
  commanderQ: number // 割当指揮官の quality bonus (§9, max(0, raw))
  adjacentCommanderQ?: number // 隣接支援由来
}

// §6.1 BattleSlot — undefined は空き slot。
export type BattleSlot = BattleRegimentState | undefined

// §6.1 BattleLine — slots.length === effectiveFrontage。
export type BattleLine = {
  slots: BattleSlot[]
}

// §10.1 BattleTactic — battle 内部 tick ごとに両軍総大将が選択する戦術 (三すくみ)。
export type BattleTactic = 'offensive' | 'defensive' | 'disruption'

// §7.2 BattleEngagementArc — 攻撃種別。
export type BattleEngagementArc = 'frontal' | 'flanking'

// §14.2 destroyed の原因タグ (ログ用)。
export type BattleDestroyedCause = 'ordinary_attrition' | 'pursuit' | 'breakthrough_pursuit'

// §15.2 BattleLogImportance — retention を決める重要度。
export type BattleLogImportance = 'minor' | 'normal' | 'major'

// §15.4 BattleLogEntry — 1 tick 内で発生した主要イベント。slot index を持つ (§15.5)。
export type BattleTacticLogEntry = {
  kind: 'tactic'
  side: WarSideKey
  tactic: BattleTactic
}

export type BattleRetreatLogEntry = {
  kind: 'retreat'
  side: WarSideKey
  regimentId: RegimentId
  slotIndex: number
}

export type BattleRoutLogEntry = {
  kind: 'rout'
  side: WarSideKey
  regimentId: RegimentId
  slotIndex: number
}

export type BattlePursuitLogEntry = {
  kind: 'pursuit'
  side: WarSideKey // pursuer (追撃する側)
  pursuerRegimentId: RegimentId
  targetRegimentId: RegimentId
  targetSlotIndex: number
  destroyed: boolean
}

export type BattleBreakthroughLogEntry = {
  kind: 'breakthrough'
  side: WarSideKey // 突破した側
  regimentId: RegimentId
  targetRegimentId: RegimentId
  slotIndex: number
}

export type BattleRegimentDestroyedLogEntry = {
  kind: 'regiment_destroyed'
  side: WarSideKey // 壊滅した連隊の side
  regimentId: RegimentId
  slotIndex: number
  cause: BattleDestroyedCause
}

export type BattleFillFrontlineLogEntry = {
  kind: 'fill_frontline'
  side: WarSideKey
  regimentId: RegimentId
  slotIndex: number
}

export type BattleCommanderFeatLogEntry = {
  kind: 'commander_feat'
  side: WarSideKey
  personId: PersonId
  regimentId: RegimentId
  slotIndex: number
  feat: 'breakthrough' | 'pursuit' | 'decisive'
}

export type BattleCommanderFailureLogEntry = {
  kind: 'commander_failure'
  side: WarSideKey
  personId: PersonId
  regimentId: RegimentId
  slotIndex: number
  failure: 'regiment_destroyed' | 'rout' | 'decisive_defeat'
}

export type BattleLogEntry =
  | BattleTacticLogEntry
  | BattleRetreatLogEntry
  | BattleRoutLogEntry
  | BattlePursuitLogEntry
  | BattleBreakthroughLogEntry
  | BattleRegimentDestroyedLogEntry
  | BattleFillFrontlineLogEntry
  | BattleCommanderFeatLogEntry
  | BattleCommanderFailureLogEntry

// §15.3 BattleTickLog — null は empty slot。
export type BattleTickLog = {
  tick: number
  attackerTactic: BattleTactic
  defenderTactic: BattleTactic
  tacticAdvantageSide?: WarSideKey
  attackerSlotsBefore: (RegimentId | null)[]
  defenderSlotsBefore: (RegimentId | null)[]
  attackerSlotsAfter: (RegimentId | null)[]
  defenderSlotsAfter: (RegimentId | null)[]
  events: BattleLogEntry[]
}

// §15.2 BattleLog — top-level entity。後年参照用の source of truth (§15.1)。
export type BattleLog = {
  id: BattleLogId
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
  tickLogs: BattleTickLog[]
  // 恒久な ChronicleEntry を参照 (raw EventId は cap/purge されるため不可。§15.2)
  majorChronicleRefs?: ChronicleEntryId[]
}

// §19 battleLogIndex (WorldState に保持)。byPerson/byRegiment/byWeek は v0.49 では追加しない。
export type BattleLogIndex = {
  byWar: Record<WarId, BattleLogId[]>
}
