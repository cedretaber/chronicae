import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { PersonId } from '../types/ids'

// v0.17 §19.4: Person availability / office term 関連イベントの explain。
export function explainPersonAvailability(state: WorldState, event: SimEvent): string {
  switch (event.type) {
    case 'OFFICE_TERM_ENDED': {
      const personName = state.persons[event.actorIds[0] as PersonId]?.name ?? '?'
      return `${personName}'s term ended.`
    }
    case 'PERSON_FADED_FROM_HISTORY': {
      const p = state.persons[event.actorIds[0] as PersonId]
      const personName = p?.name ?? '?'
      return `${personName} faded from the chronicles (year ${event.year}).`
    }
    case 'PERSON_BORN_IN_OBSCURITY': {
      const p = state.persons[event.actorIds[0] as PersonId]
      const personName = p?.name ?? '?'
      const occupation = p?.occupation ?? 'stranger'
      return `An unknown ${occupation} named ${personName} appeared.`
    }
    case 'HOUSE_MEMBERS_DISPERSED': {
      const houseId = event.houseIds[0]
      const houseName = houseId ? (state.houses[houseId]?.name ?? '?') : '?'
      return `The remnants of ${houseName} dispersed into obscurity.`
    }
    default:
      return event.summary
  }
}
