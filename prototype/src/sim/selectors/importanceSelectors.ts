import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import { getPersonRole } from './roleSelectors'

const ROLE_BONUS: Record<string, number> = {
  chancellor: 30,
  general: 20,
  treasurer: 20,
}

export function calcPersonImportanceScore(
  state: WorldState,
  personId: PersonId,
  eventHistory: SimEvent[],
): number {
  const person = state.persons[personId]
  if (!person || !person.alive) return 0

  const house = state.houses[person.houseId]
  const housePrestige = house ? house.legacyPrestige : 0

  const role = getPersonRole(state, personId)
  const roleBonus = role ? (ROLE_BONUS[role] ?? 0) : 0

  const cutoffMonths = state.currentYear * 12 + state.currentMonth - 12
  const recentInvolvement = eventHistory.filter((e) => {
    const eMonths = e.year * 12 + e.month
    return (
      eMonths >= cutoffMonths && e.actorIds.some((id) => (id as string) === (personId as string))
    )
  }).length

  return (
    roleBonus +
    housePrestige * 0.3 +
    person.legacyPrestige +
    person.stats.admin * 3 +
    person.stats.martial * 3 +
    person.traits.ambition * 20 +
    recentInvolvement * 5
  )
}
