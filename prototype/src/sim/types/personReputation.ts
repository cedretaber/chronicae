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

type ReputationOutcome = 'success' | 'failure'

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
  // v0.48: 民衆反乱の代官罷免による統治失敗の悪評 (stewardship)。
  | { kind: 'revolt'; playId?: DiplomaticPlayId }

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
  // 影響力個人中心化 Phase 1a: relatedOrganization 別の引き当て。
  // key = personReputationOrganizationKey(relatedOrganization) = `${kind}:${id}` (polity / house)。
  // relatedOrganization は optional なので、tag された評判のみ index 入りする。
  // influence read-model (polity-tag) / House Share 再計算 (house-tag) が polity/house 単位で
  // 評判を引くために使う (byPerson 全走査の perf 退行を回避 — §12.1 / R1)。
  byOrganization: Record<string, PersonReputationId[]>
}

// byOrganization index の key。OrganizationRef (polity / house) を `${kind}:${id}` に正規化する。
// influenceSelectors の polityInfluenceHolderKey({kind:'polity', id}) と同一文字列になるよう揃える。
export function personReputationOrganizationKey(org: OrganizationRef): string {
  return `${org.kind}:${org.id}`
}
