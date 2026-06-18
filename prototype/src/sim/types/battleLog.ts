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
import type { BattleOutcomeQuality, BattleCommanderAssignment } from './battle'

// §6.1 BattleRegimentState / BattleSlot / BattleLine は simulateBattle 実行中のみ存在する live 型であり、
//   永続化されない (BattleTickLog は slot を (RegimentId | null)[] で snapshot する)。実体は
//   simulateBattle.ts の内部型 WorkRegiment が担い、BattleSlot = WorkRegiment | undefined として
//   simulateBattle.ts に定義する。ここ (永続層の型) には置かない (v0.49 §6.1 / spec 同期)。

// §10.1 BattleTactic — battle 内部 tick ごとに両軍総大将が選択する戦術 (三すくみ)。
export type BattleTactic = 'offensive' | 'defensive' | 'disruption'

// §7.2 BattleEngagementArc — 攻撃種別。
export type BattleEngagementArc = 'frontal' | 'flanking'

// §14.2 destroyed の原因タグ (ログ用)。
export type BattleDestroyedCause =
  | 'ordinary_attrition'
  | 'pursuit'
  | 'breakthrough_pursuit'
  | 'cavalry_charge_pursuit'

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

// v0.50 cavalry charge
export type BattleCavalryChargeLogEntry = {
  kind: 'cavalry_charge'
  side: WarSideKey
  cavalryRegimentId: RegimentId
  commanderPersonId?: PersonId
  targetRegimentId: RegimentId
  targetSlotIndex: number
  result: 'success' | 'failure'
}

// v0.50 cavalry pursuit (reserve cavalry による追撃)
export type BattleCavalryPursuitLogEntry = {
  kind: 'cavalry_pursuit'
  side: WarSideKey
  cavalryRegimentId: RegimentId
  targetRegimentId: RegimentId
  targetSlotIndex: number
  destroyed: boolean
}

// v0.50 cavalry screen
export type BattleCavalryScreenLogEntry = {
  kind: 'cavalry_screen'
  side: WarSideKey
  cavalryRegimentId: RegimentId
  screenedRegimentId: RegimentId
  screenedSlotIndex: number
}

// v0.50 morale shift
export type BattleMoraleShiftLogEntry = {
  kind: 'morale_shift'
  side: WarSideKey
  rallyTotal: number
  shockTotal: number
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
  | BattleCavalryChargeLogEntry
  | BattleCavalryPursuitLogEntry
  | BattleCavalryScreenLogEntry
  | BattleMoraleShiftLogEntry

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
  // 会戦再生 UI 用: 現場指揮官 → 連隊の割当 (Battle entity から恒久コピー。Battle は war cleanup で消えるため
  //   後年参照には BattleLog 側に保持する。slot ラベルに「どの指揮官が率いたか」を表示する素材)。
  attackerCommanders?: BattleCommanderAssignment[]
  defenderCommanders?: BattleCommanderAssignment[]
  tickLogs: BattleTickLog[]
  // 恒久な ChronicleEntry を参照 (raw EventId は cap/purge されるため不可。§15.2)
  majorChronicleRefs?: ChronicleEntryId[]
}

// §19 battleLogIndex (WorldState に保持)。byPerson/byRegiment/byWeek は v0.49 では追加しない。
export type BattleLogIndex = {
  byWar: Record<WarId, BattleLogId[]>
}
