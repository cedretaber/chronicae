import type { PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import { getRoleScore } from './abilitySelectors'

const OFFICE_BONUS: Record<string, number> = {
  leader: 40,
  administrator: 30,
  military: 20,
  treasurer: 20,
  advisor: 10,
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

  // Find best office role bonus via officeIndex
  const officeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  let roleBonus = 0
  for (const officeId of officeIds) {
    const office = state.officeAssignments[officeId]
    if (!office || !office.active) continue
    const bonus = OFFICE_BONUS[office.role] ?? 0
    if (bonus > roleBonus) roleBonus = bonus
  }

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
    (getRoleScore(state, personId, 'governance') / 10) * 3 +
    (getRoleScore(state, personId, 'warCommand') / 10) * 3 +
    person.traits.ambition * 20 +
    recentInvolvement * 5
  )
}
