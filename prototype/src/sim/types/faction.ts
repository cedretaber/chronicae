import type { PersonId, FactionId, FactionMembershipId, PolityId } from './ids'

export type Faction = {
  id: FactionId
  leaderPersonId: PersonId
  // v0.42 §12: anchor Polity。founding 時に leader の家の primary polity (なければ
  // seatProvince の terminal polity) で決定し、以後変更しない。anchor が inactive に
  // なったら Faction は即時解散する (polityOwnerConsistency の deactivate cascade)。
  // Faction が任命・Influence に介入できるのは anchor Polity のみ (§12.4)。
  polityId: PolityId
  active: boolean
  foundingWeek: number
  // 派閥拡大 入れ子 (Phase 2-a, モデル A): 庇護者の傘下に入った場合の親派閥。
  // root 派閥は undefined。子派閥の leader は親の member には「ならない」(派閥同士の
  // ポインタで表現し §4.4・FactionMembership・募集ロジックを無改修で保つ)。
  // 親が解散したら子は orphan 化 (root へ昇格) する (§4.5)。
  parentFactionId?: FactionId
}

export type FactionMembership = {
  id: FactionMembershipId
  factionId: FactionId
  personId: PersonId
  active: boolean
  joinedWeek: number
}

export type FactionIndex = {
  byLeader: Record<PersonId, FactionId[]>
  byMember: Record<PersonId, FactionMembershipId[]>
  // v0.42: anchor Polity → FactionId[]。byLeader と同様 active/inactive 両方を保持し、
  // 読み手が active filter する。
  byPolity: Record<PolityId, FactionId[]>
  // 入れ子 (Phase 2-a): 親 FactionId → 子 FactionId[]。親派閥の傘下 (直接の子) を引く。
  // active な親子関係のみ保持し、解散時に維持する (deactivate/orphan で同期)。
  byParent: Record<FactionId, FactionId[]>
}
