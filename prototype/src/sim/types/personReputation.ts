// v0.44 PersonReputation: 成果 (Project / DiplomaticPlay / War) に由来する人物の評判。
//
// - baseScore を保存し、現在値は selector (getCurrentPersonReputationScore) で月次減衰計算する。
// - expiryWeek は作成時に事前計算して保存する (§4.4)。cleanup は absoluteWeek >= expiryWeek の
//   比較だけで削除できる。
// - outcome は UI 表示・将来の subtype 分類・positive/negative filtering 用。
//   現在値の計算・任用補正は baseScore の符号に基づき、outcome は参照しない (§4.1)。
// - hard-delete (cleanup §4.5: expiry 超過 or 本人死亡のみ。index 不整合は integrity §12.1 の検出対象)。

import type { PersonReputationId, PersonId, ProjectId, DiplomaticPlayId, WarId } from './ids'
import type { ProjectKind } from './project'
import type { DiplomaticPlayKind } from './diplomaticPlay'
import type { OrganizationRef } from './office'
import type { EntityRef } from './goal'

export type ReputationOutcome = 'success' | 'failure'

export type ReputationCategory =
  | 'administration'
  | 'military'
  | 'diplomacy'
  | 'culture'
  | 'stewardship'
  | 'intrigue'
  | 'general'

export const VALID_REPUTATION_CATEGORIES: ReadonlyArray<ReputationCategory> = [
  'administration',
  'military',
  'diplomacy',
  'culture',
  'stewardship',
  'intrigue',
  'general',
]

export type PersonReputationSource =
  | { kind: 'project'; projectKind: ProjectKind; projectId?: ProjectId }
  | { kind: 'diplomatic_play'; playKind: DiplomaticPlayKind; playId?: DiplomaticPlayId }
  | { kind: 'war'; warId?: WarId }

export type PersonReputation = {
  id: PersonReputationId
  personId: PersonId
  source: PersonReputationSource
  outcome: ReputationOutcome
  category: ReputationCategory
  baseScore: number
  createdWeek: number
  expiryWeek: number
  relatedOrganization?: OrganizationRef
  relatedRefs: EntityRef[]
}

export type PersonReputationIndex = {
  byPerson: Record<PersonId, PersonReputationId[]>
}
