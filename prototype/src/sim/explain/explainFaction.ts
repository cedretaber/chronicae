import type { SimEvent } from '../types/event'
import {
  getEntityIdsByKind,
  getEntityRefByRole,
  getFirstEntityId,
  renderEventSummary,
} from '../types/event'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId, FactionId } from '../types/ids'

type FactionEventType =
  | 'FACTION_FOUNDED'
  | 'FACTION_DISSOLVED'
  | 'FACTION_LEADER_CHANGED'
  | 'PERSON_RECRUITED_TO_FACTION'
  | 'FACTION_FUNDS_SHORTAGE'
  | 'FACTION_MEMBER_ABANDONED'
  | 'FACTION_LEADER_BANKRUPT'

function findFactionByActor(state: WorldState, personIds: string[]): FactionId | undefined {
  for (const actor of personIds) {
    const factionIds = state.factionIndex.byLeader[actor as PersonId]
    if (factionIds) {
      for (const fid of factionIds) {
        const f = state.factions[fid]
        if (f) return fid
      }
    }
    const membershipIds = state.factionIndex.byMember[actor as PersonId]
    if (membershipIds) {
      for (const mid of membershipIds) {
        const m = state.factionMemberships[mid]
        if (m) return m.factionId
      }
    }
  }
  return undefined
}

export function explainFaction(state: WorldState, event: SimEvent): string {
  if (!isFactionEvent(event.type)) return renderEventSummary(event)

  const personIds = getEntityIdsByKind(event, 'person')
  const factionId = findFactionByActor(state, personIds)
  const faction = factionId ? state.factions[factionId] : undefined
  const factionLeader = faction ? state.persons[faction.leaderPersonId] : undefined
  const factionName = factionLeader?.nameKey ?? faction?.id ?? 'unknown'

  const namesOf = (ids: string[]): string =>
    ids
      .map((id) => state.persons[id as PersonId]?.nameKey)
      .filter((n): n is string => n !== undefined)
      .join(', ')

  const houseId = getFirstEntityId(event, 'house')
  const houseName = houseId ? state.houses[houseId as HouseId]?.nameKey : undefined

  switch (event.type) {
    case 'FACTION_FOUNDED': {
      const leaderRef = getEntityRefByRole(event, 'leader')
      const leaderName = leaderRef ? (state.persons[leaderRef.id as PersonId]?.nameKey ?? '?') : '?'
      const memberIds = personIds.filter((id) => id !== leaderRef?.id)
      const memberNames = namesOf(memberIds)
      const seat = houseName ? ` (${houseName})` : ''
      return memberNames
        ? `${leaderName}${seat} founded the faction ${factionName}, joined by ${memberNames}.`
        : `${leaderName}${seat} founded the faction ${factionName}.`
    }
    case 'FACTION_DISSOLVED':
      return renderEventSummary(event)
    case 'FACTION_LEADER_CHANGED': {
      const oldRef = getEntityRefByRole(event, 'oldLeader')
      const newRef = getEntityRefByRole(event, 'newLeader')
      const oldName = oldRef ? (state.persons[oldRef.id as PersonId]?.nameKey ?? '?') : '?'
      const newName = newRef ? (state.persons[newRef.id as PersonId]?.nameKey ?? '?') : '?'
      return `${newName} succeeded ${oldName} as the head of ${factionName}.`
    }
    case 'PERSON_RECRUITED_TO_FACTION': {
      const leaderRef = getEntityRefByRole(event, 'leader')
      const recruitRef = getEntityRefByRole(event, 'recruit')
      const leaderName = leaderRef ? (state.persons[leaderRef.id as PersonId]?.nameKey ?? '?') : '?'
      const candName = recruitRef ? (state.persons[recruitRef.id as PersonId]?.nameKey ?? '?') : '?'
      return `${candName} joined ${factionName} (recruited by ${leaderName}).`
    }
    case 'FACTION_FUNDS_SHORTAGE':
      return `${factionName} faces a financial crisis.`
    case 'FACTION_MEMBER_ABANDONED': {
      const personId = getFirstEntityId(event, 'person')
      const memberName = personId ? (state.persons[personId as PersonId]?.nameKey ?? '?') : '?'
      return `${memberName} abandoned ${factionName}.`
    }
    case 'FACTION_LEADER_BANKRUPT': {
      const personId = getFirstEntityId(event, 'person')
      const leaderName = personId ? (state.persons[personId as PersonId]?.nameKey ?? '?') : '?'
      return `${leaderName}'s fortunes are exhausted, putting ${factionName} in jeopardy.`
    }
  }
}

function isFactionEvent(type: SimEvent['type']): type is FactionEventType {
  return (
    type === 'FACTION_FOUNDED' ||
    type === 'FACTION_DISSOLVED' ||
    type === 'FACTION_LEADER_CHANGED' ||
    type === 'PERSON_RECRUITED_TO_FACTION' ||
    type === 'FACTION_FUNDS_SHORTAGE' ||
    type === 'FACTION_MEMBER_ABANDONED' ||
    type === 'FACTION_LEADER_BANKRUPT'
  )
}
