// v0.51 InfluenceModifier (陰謀リファイン): 影響力の符号付き・期限付き修正項。
//
// Influence は read-model (influenceSelectors.getPolityInfluenceBreakdown) であり state に
// 保存されない。「Influence を下げる/上げる」には計算に入る基礎データを足すしかないため、
// 計算へ加味する専用エンティティとして導入する。
//
// - delta は符号付き。負 = 毀損 (影響力毀損陰謀の成果)、正 = 付与 (将来: 恩賞・祭礼)。
// - influenceSelectors が `standing` ドメインとして breakdown に加味する (§2.3)。
// - 期限切れ・target 消滅・polity inactive は influenceModifierConsistencySystem が回収する。
// - PoliticalRight と同じく hard-delete・index 同期は mutation 層で閉じる。

import type { InfluenceModifierId, PolityId, HouseId, PersonId } from './ids'

export type InfluenceModifierCauseKind =
  | 'conspiracy_undermine' // 影響力毀損陰謀の成果 (delta < 0)
  | 'favor' // 将来: 恩賞・祭礼などの一時的上昇 (delta > 0)

export type InfluenceModifierTargetRef =
  | { kind: 'house'; id: HouseId }
  | { kind: 'person'; id: PersonId }

export type InfluenceModifier = {
  id: InfluenceModifierId
  polityId: PolityId // どの Polity の influence breakdown に効くか
  target: InfluenceModifierTargetRef // 誰の influence を動かすか
  delta: number // 符号付き influence スコア (負=毀損 / 正=付与)
  causeKind: InfluenceModifierCauseKind
  sourcePersonId?: PersonId // 陰謀の supervisor (年代記表示用)
  grantedWeek: number
  expiryWeek?: number // 期限。undefined = 恒久 (v1 の陰謀毀損は期限付きを既定とする)
}

// byTarget index のキー。politicalRightHolderKey と同じ `kind:id` 規約。
export function influenceModifierTargetKey(target: InfluenceModifierTargetRef): string {
  return `${target.kind}:${target.id}`
}

export type InfluenceModifierIndex = {
  byPolity: Record<string, InfluenceModifierId[]>
  byTarget: Record<string, InfluenceModifierId[]>
}
