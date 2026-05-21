import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { markPersonDead } from '../mutations/personMutations'
import type { PersonId } from '../types/ids'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { nameParam, entityRef } from '../types/event'

export function runMortalitySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const personId of Object.keys(ctx.state.persons).sort()) {
    const person = currentCtx.state.persons[personId as PersonId]
    if (!person || !person.alive) continue
    if (person.kind === 'placeholder') continue

    const deathRate =
      person.age <= 39 ? 0.004 : person.age <= 59 ? 0.01 : person.age <= 69 ? 0.025 : 0.05

    const { value: deathCheck, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    if (deathCheck < deathRate) {
      // Check if person was a house/polity leader BEFORE revoking
      const houseLeaderBefore = getHouseLeader(currentCtx.state, person.houseId)
      const wasHouseLeader = houseLeaderBefore === (personId as PersonId)
      const personPrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, person.houseId)
      const polityRulerBefore = personPrimaryPolityId
        ? getPolityLeader(currentCtx.state, personPrimaryPolityId)
        : undefined
      const wasPolityLeader = polityRulerBefore === (personId as PersonId)

      const deadResult = markPersonDead(currentCtx.state, personId as PersonId)
      const currentState = deadResult.ok ? deadResult.value : currentCtx.state

      const importance = wasHouseLeader ? 'normal' : 'minor'

      const house = currentState.houses[person.houseId]
      const { event, ctx: eventCtx } = createSimEvent(
        { ...currentCtx, state: currentState },
        {
          type: 'PERSON_DIED',
          importance,
          messageKey: 'person.died',
          messageParams: {
            person: nameParam('person', person.nameKey, person.name),
            age: person.age,
          },
          entityRefs: [
            entityRef('person', personId, 'deceased', person.nameKey),
            entityRef('house', person.houseId, 'house', house?.nameKey),
          ],
        },
      )

      currentCtx = {
        ...eventCtx,
        state: currentState,
        events: [...eventCtx.events, event],
        deathsThisTick: [...eventCtx.deathsThisTick, personId as PersonId],
        deathRolesThisTick: {
          ...eventCtx.deathRolesThisTick,
          [personId]: { wasHouseLeader, wasPolityLeader },
        },
      }
    }
  }

  return currentCtx
}
