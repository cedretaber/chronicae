import type { SimEvent } from '../types/event'
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

function findFactionByActor(state: WorldState, actorIds: PersonId[]): FactionId | undefined {
  for (const actor of actorIds) {
    const factionIds = state.factionIndex.byLeader[actor]
    if (factionIds) {
      for (const fid of factionIds) {
        const f = state.factions[fid]
        if (f) return fid
      }
    }
    const membershipIds = state.factionIndex.byMember[actor]
    if (membershipIds) {
      for (const mid of membershipIds) {
        const m = state.factionMemberships[mid]
        if (m) return m.factionId
      }
    }
  }
  return undefined
}

// v0.17 §19.4: Faction 関連イベントの explain (Chronicle 表示用)。
// SimEvent.summary は既に存在するが、explain は actor / house の追加文脈を付与する。
export function explainFaction(state: WorldState, event: SimEvent): string {
  if (!isFactionEvent(event.type)) return event.summary

  const factionId = findFactionByActor(state, event.actorIds)
  const faction = factionId ? state.factions[factionId] : undefined
  const factionName = faction?.name ?? 'an unknown faction'

  const namesOf = (ids: PersonId[]): string =>
    ids
      .map((id) => state.persons[id]?.name)
      .filter((n): n is string => n !== undefined)
      .join(', ')

  const houseName = (id: HouseId | undefined): string | undefined =>
    id ? state.houses[id]?.name : undefined

  switch (event.type) {
    case 'FACTION_FOUNDED': {
      const leaderName = state.persons[event.actorIds[0] as PersonId]?.name ?? '?'
      const memberNames = namesOf(event.actorIds.slice(1))
      const where = houseName(event.houseIds[0])
      const seat = where ? ` (${where})` : ''
      return memberNames
        ? `${leaderName}${seat} founded the faction ${factionName}, joined by ${memberNames}.`
        : `${leaderName}${seat} founded the faction ${factionName}.`
    }
    case 'FACTION_DISSOLVED':
      return event.summary
    case 'FACTION_LEADER_CHANGED': {
      const oldName = state.persons[event.actorIds[0] as PersonId]?.name ?? '?'
      const newName = state.persons[event.actorIds[1] as PersonId]?.name ?? '?'
      return `${newName} succeeded ${oldName} as the head of ${factionName}.`
    }
    case 'PERSON_RECRUITED_TO_FACTION': {
      const leaderName = state.persons[event.actorIds[0] as PersonId]?.name ?? '?'
      const candName = state.persons[event.actorIds[1] as PersonId]?.name ?? '?'
      return `${candName} joined ${factionName} (recruited by ${leaderName}).`
    }
    case 'FACTION_FUNDS_SHORTAGE':
      return `${factionName} faces a financial crisis.`
    case 'FACTION_MEMBER_ABANDONED': {
      const memberName = state.persons[event.actorIds[0] as PersonId]?.name ?? '?'
      return `${memberName} abandoned ${factionName}.`
    }
    case 'FACTION_LEADER_BANKRUPT': {
      const leaderName = state.persons[event.actorIds[0] as PersonId]?.name ?? '?'
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
