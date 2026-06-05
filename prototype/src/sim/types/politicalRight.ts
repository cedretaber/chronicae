// v0.42 PoliticalRight: Polity 内の具体的な政治権利 (任命権・連隊管理権)。
//
// - right が存在しない状態は residual authority (現行ロジックがそのまま機能する) であり、
//   entity としては保存しない (spec v0.42 §3.2)。
// - kind / tenure フィールドは持たない。kind は target.kind から、失効ルールは holder.kind
//   から導出する (§4.2)。保存すると drift の余地だけが生まれるため。
// - 同一 target に対して active right は最大 1 つ (§4.2.2)。byTarget index の各 entry は
//   length <= 1 を integrity で要求する。
// - hard-delete (§4.2.3)。active=false 残置はしない (v0.17.3 B の office と同パターン)。

import type { PoliticalRightId, PolityId, HouseId, PersonId, HoldingId, RegimentId } from './ids'
import type { OfficeRole } from './office'

export type PoliticalRightHolderRef =
  | { kind: 'person'; id: PersonId }
  | { kind: 'house'; id: HouseId }

// polity_office_role は slot 単位 (v0.42 slot 化): 1 right が支配するのは役職全体ではなく
// 特定スロット 1 席。slotIndex は 0-based で、effectiveMax 縮小時は後ろの slot から失効する
// (rightConsistencySystem)。失効した right は領土回復で slot が戻っても復活しない (hard-delete)。
export type PoliticalRightTargetRef =
  | { kind: 'polity_office_role'; polityId: PolityId; role: OfficeRole; slotIndex: number }
  | { kind: 'holding_office_role'; holdingId: HoldingId; role: 'bailiff' }
  | { kind: 'regiment'; regimentId: RegimentId }

export type PoliticalRight = {
  id: PoliticalRightId
  polityId: PolityId
  target: PoliticalRightTargetRef
  holder: PoliticalRightHolderRef
  grantedWeek: number
}

// 失効ルール (§4.2.1):
//   holder.kind === 'person' → personal right。holder Person の死亡で失効。
//   holder.kind === 'house'  → household right。holder House の inactive / extinct で失効。
export type PoliticalRightKind =
  | 'polity_office_appointment'
  | 'holding_office_appointment'
  | 'regiment_control'

export function getPoliticalRightKindFromTarget(
  target: PoliticalRightTargetRef,
): PoliticalRightKind {
  switch (target.kind) {
    case 'polity_office_role':
      return 'polity_office_appointment'
    case 'holding_office_role':
      return 'holding_office_appointment'
    case 'regiment':
      return 'regiment_control'
  }
}

// byTarget index のキー (§4.3.1)。1-target-1-right の dedupe キーとしても使う。
export function politicalRightTargetKey(target: PoliticalRightTargetRef): string {
  switch (target.kind) {
    case 'polity_office_role':
      return `polity_office_role:${target.polityId}:${target.role}:${target.slotIndex}`
    case 'holding_office_role':
      return `holding_office_role:${target.holdingId}:${target.role}`
    case 'regiment':
      return `regiment:${target.regimentId}`
  }
}

// byHolder index のキー。shareIndex.byHolder と同じ `kind:id` 規約。
export function politicalRightHolderKey(holder: PoliticalRightHolderRef): string {
  return `${holder.kind}:${holder.id}`
}

export type PoliticalRightIndex = {
  byPolity: Record<PolityId, PoliticalRightId[]>
  byHolder: Record<string, PoliticalRightId[]>
  byTarget: Record<string, PoliticalRightId[]>
}
