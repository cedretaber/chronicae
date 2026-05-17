import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { revokeOfficesByHolder } from '../mutations/officeMutations'
import { clearSpouse } from '../mutations/relationshipMutations'
import type { PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { getHouseLeader } from '../selectors/officeSelectors'

export function runMortalitySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const personId of Object.keys(ctx.state.persons).sort()) {
    const person = currentCtx.state.persons[personId as PersonId]
    if (!person || !person.alive) continue

    const deathRate =
      person.age <= 39 ? 0.004 : person.age <= 59 ? 0.01 : person.age <= 69 ? 0.025 : 0.05

    const { value: deathCheck, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    if (deathCheck < deathRate) {
      // Check if person was a house leader BEFORE revoking
      const houseLeaderBefore = getHouseLeader(currentCtx.state, person.houseId)
      const wasHouseLeader = houseLeaderBefore === (personId as PersonId)

      const newPersons = { ...currentCtx.state.persons }
      newPersons[personId as PersonId] = { ...person, alive: false }
      let currentState = { ...currentCtx.state, persons: newPersons }

      const clearResult = clearSpouse(currentState, personId as PersonId)
      if (clearResult.ok) currentState = clearResult.value

      currentState = revokeOfficesByHolder(currentState, personId as PersonId)

      const importance = wasHouseLeader ? 'normal' : 'minor'

      const { id: eventId, ctx: eventCtx } = makeEventId({ ...currentCtx, state: currentState })

      const event: SimEvent = {
        id: eventId,
        year: currentState.currentYear,
        month: currentState.currentMonth,
        type: 'PERSON_DIED',
        importance,
        actorIds: [personId as PersonId],
        houseIds: [person.houseId],
        countryIds: [person.countryId],
        provinceIds: [],
        summary: person.name + ' has died at age ' + person.age + '.',
        reasons: [],
        effects: [],
      }

      currentCtx = {
        ...eventCtx,
        state: currentState,
        events: [...eventCtx.events, event],
      }
    }
  }

  return currentCtx
}
