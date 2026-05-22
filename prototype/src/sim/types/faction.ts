import type { PersonId, FactionId, FactionMembershipId } from './ids'

export type Faction = {
  id: FactionId
  leaderPersonId: PersonId
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
}
