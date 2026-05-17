import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { markPersonDead } from '../mutations/personMutations'
import type { PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { getHouseLeader, getCountryRuler } from '../selectors/officeSelectors'

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
      // Check if person was a house/country leader BEFORE revoking
      const houseLeaderBefore = getHouseLeader(currentCtx.state, person.houseId)
      const wasHouseLeader = houseLeaderBefore === (personId as PersonId)
      const countryRulerBefore = getCountryRuler(currentCtx.state, person.countryId)
      const wasCountryLeader = countryRulerBefore === (personId as PersonId)

      const deadResult = markPersonDead(currentCtx.state, personId as PersonId)
      const currentState = deadResult.ok ? deadResult.value : currentCtx.state

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
        deathsThisTick: [...eventCtx.deathsThisTick, personId as PersonId],
        deathRolesThisTick: {
          ...eventCtx.deathRolesThisTick,
          [personId]: { wasHouseLeader, wasCountryLeader },
        },
      }
    }
  }

  return currentCtx
}
