import type { WorldState } from '@sim/types/world'
import type { PersonId, FactionId, FactionMembershipId } from '@sim/types/ids'
import type { Faction, FactionMembership } from '@sim/types/faction'

export function getActiveFactions(state: WorldState): Faction[] {
  const result: Faction[] = []
  for (const id of Object.keys(state.factions).sort() as FactionId[]) {
    const f = state.factions[id]
    if (f && f.active) result.push(f)
  }
  return result
}

export function getFaction(state: WorldState, factionId: FactionId): Faction | undefined {
  return state.factions[factionId]
}

export function getFactionMembership(
  state: WorldState,
  membershipId: FactionMembershipId,
): FactionMembership | undefined {
  return state.factionMemberships[membershipId]
}

// Returns the active Faction this person currently leads, if any.
export function getFactionByLeader(state: WorldState, personId: PersonId): Faction | undefined {
  const factionIds = state.factionIndex.byLeader[personId]
  if (!factionIds) return undefined
  for (const fid of factionIds) {
    const f = state.factions[fid]
    if (f && f.active && f.leaderPersonId === personId) return f
  }
  return undefined
}

// Returns the active FactionMembership this person currently holds, if any.
// Per spec §4.4 invariant: a Person has at most 1 active membership.
export function getActiveFactionMembership(
  state: WorldState,
  personId: PersonId,
): FactionMembership | undefined {
  const ids = state.factionIndex.byMember[personId]
  if (!ids) return undefined
  for (const mid of ids) {
    const m = state.factionMemberships[mid]
    if (m && m.active) return m
  }
  return undefined
}

// Returns all PersonIds in active membership of the given faction.
export function getFactionActiveMemberIds(state: WorldState, factionId: FactionId): PersonId[] {
  const result: PersonId[] = []
  for (const m of Object.values(state.factionMemberships)) {
    if (!m) continue
    if (m.factionId !== factionId) continue
    if (!m.active) continue
    result.push(m.personId)
  }
  return result.sort()
}
