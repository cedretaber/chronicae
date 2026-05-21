import type { SimEvent } from '../types/event'
import { getFirstEntityId, renderEventSummary } from '../types/event'
import type { WorldState } from '../types/world'
import type { PersonId, HouseId } from '../types/ids'

export function explainPersonAvailability(state: WorldState, event: SimEvent): string {
  switch (event.type) {
    case 'OFFICE_TERM_ENDED': {
      const pid = getFirstEntityId(event, 'person')
      const personName = pid ? (state.persons[pid as PersonId]?.name ?? '?') : '?'
      return `${personName}'s term ended.`
    }
    case 'PERSON_FADED_FROM_HISTORY': {
      const pid = getFirstEntityId(event, 'person')
      const p = pid ? state.persons[pid as PersonId] : undefined
      const personName = p?.name ?? '?'
      return `${personName} faded from the chronicles (year ${event.year}).`
    }
    case 'PERSON_BORN_IN_OBSCURITY': {
      const pid = getFirstEntityId(event, 'person')
      const p = pid ? state.persons[pid as PersonId] : undefined
      const personName = p?.name ?? '?'
      const occupation = p?.occupation ?? 'stranger'
      return `An unknown ${occupation} named ${personName} appeared.`
    }
    case 'HOUSE_MEMBERS_DISPERSED': {
      const hid = getFirstEntityId(event, 'house')
      const houseName = hid ? (state.houses[hid as HouseId]?.name ?? '?') : '?'
      return `The remnants of ${houseName} dispersed into obscurity.`
    }
    default:
      return renderEventSummary(event)
  }
}
