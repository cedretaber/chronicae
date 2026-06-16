import type { CrisisId, HoldingId, ProjectId, WarId, PersonId, DecisionReasonId } from './ids'

// v0.48 Crisis: 対処を要する局所的事態 (不作・疫病・干魃・戦災・反乱前段) のエンティティ化。
// Pressure と同じ「ハザード entity + 対処 Project」の二段構成だが相手方を持たない。
// 被害は severity に保持し (entity 内完結)、active な間だけ週次でデバフを適用する。
export type CrisisKind = 'famine' | 'plague' | 'drought' | 'war_damage' | 'unrest'

// active = 対処中/放置中。resolved = severity 0 で解消。expired = deadline 未解決で打ち切り。
export type CrisisStatus = 'active' | 'resolved' | 'expired'

// 反乱 (unrest) の要求。生成時に decideRevoltDemand で確定し Crisis に保持する (§5.3)。
// Phase A では型のみ用意し、Phase C で provinceRevoltSystem 側を本型に統一する。
export type RevoltDemand =
  | { kind: 'secession' }
  | { kind: 'bailiff_dismissal'; bailiffPersonId: PersonId }
  | { kind: 'tax_relief' }

export type Crisis = {
  id: CrisisId
  kind: CrisisKind
  holdingId: HoldingId // 被災 holding (粒度の核, §0-5)。所有はここから live 解決 (§0-10)
  severity: number // 0–100。active 中はこれに比例して週次デバフ
  createdWeek: number
  deadlineWeek: number // 有効期間の終端
  status: CrisisStatus
  responseProjectId?: ProjectId // HandleCrisisProject への参照 (Pressure と同形)
  // kind 別メタ
  sourceWarId?: WarId // kind === 'war_damage'
  demand?: RevoltDemand // kind === 'unrest'。生成時に decideRevoltDemand で確定 (§5.3)
  reasonIds: DecisionReasonId[]
}

export type CrisisIndex = {
  byHolding: Record<string, CrisisId[]>
  byProject: Record<ProjectId, CrisisId[]>
}
