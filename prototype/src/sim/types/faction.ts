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
}
