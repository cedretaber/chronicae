// v0.42 §5: Polity Influence read-model 型。
//
// Influence は entity ではなく selector の戻り値 (read-model)。
// 「直接増やす」対象ではなく、具体的な権利・役職・土地・軍事管理・派閥支持から導出する。

import type { PolityId, HouseId, PersonId } from './ids'

export type PolityInfluenceDomain =
  | 'base'
  | 'ruler'
  | 'office'
  | 'military'
  | 'land_administration'
  | 'landed_power'
  | 'wealth'
  | 'prestige'
  | 'faction'
  // 影響力個人中心化 Phase 1a: 成果項 (polity-tag PersonReputation の現在値合計 × factor)。
  // 構造項 (役職/任命権/土地) と並ぶ第二の影響力供給源。person キーで個人帰属。
  | 'reputation'

export type PolityInfluenceHolderRef =
  | { kind: 'house'; id: HouseId }
  | { kind: 'person'; id: PersonId }

export type PolityInfluenceEntry = {
  holder: PolityInfluenceHolderRef
  byDomain: Partial<Record<PolityInfluenceDomain, number>>
  total: number
  // 0〜100 (§5.5)。0〜1 の比率が必要な箇所では percent / 100 を使う。
  percent: number
}

export type PolityInfluenceBreakdown = {
  polityId: PolityId
  // total 降順 (同値は holder key 昇順で安定)
  entries: PolityInfluenceEntry[]
  totalScore: number
}

export function polityInfluenceHolderKey(holder: PolityInfluenceHolderRef): string {
  return `${holder.kind}:${holder.id}`
}

// 家単位にまとめた influence breakdown (UI 表示用 read-model)。
// 「家の支配率 = 家本体 + 家中メンバー個人」(getHouseAggregateInfluenceFromBreakdown と同義) を、
// 家ごとのグループ + その内訳セグメントとして構造化する。
// - groups: 家の支配率 (aggregatePercent) 降順。家を持たない有力 person は houseId=undefined の単独グループ。
// - 各グループの segments: 家本体 (kind:'house') を先頭に、メンバー person を influence 降順。
// - othersPercent: 表示閾値 (minGroupPercent) 未満のグループを集約した残余。
export type PolityInfluenceGroupSegment = {
  // kind:'house' = 家本体のセグメント / kind:'person' = 家中メンバー (houseless グループでは本人)
  holder: PolityInfluenceHolderRef
  byDomain: Partial<Record<PolityInfluenceDomain, number>>
  percent: number
}

export type PolityInfluenceGroup = {
  // undefined = 家を持たない person の単独グループ
  houseId: HouseId | undefined
  aggregatePercent: number
  aggregateByDomain: Partial<Record<PolityInfluenceDomain, number>>
  // 家本体を先頭に、メンバーを percent 降順 (houseless グループは本人 1 件のみ)
  segments: PolityInfluenceGroupSegment[]
}

export type GroupedPolityInfluence = {
  polityId: PolityId
  // aggregatePercent 降順 (同値はグループキー昇順で安定)
  groups: PolityInfluenceGroup[]
  othersPercent: number
  othersByDomain: Partial<Record<PolityInfluenceDomain, number>>
}
