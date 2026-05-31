import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { markPersonDead } from '../mutations/personMutations'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { nameParam, entityRef } from '../types/event'

export function runMortalitySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const personId of ctx.state.livingPersonIds) {
    const person = currentCtx.state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue

    const deathRate =
      person.age <= 39 ? 0.004 : person.age <= 59 ? 0.01 : person.age <= 69 ? 0.025 : 0.05

    const { value: deathCheck, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    if (deathCheck < deathRate) {
      if (!person.houseId) continue

      // Check if person was a house/polity leader BEFORE revoking
      const houseLeaderBefore = getHouseLeader(currentCtx.state, person.houseId)
      const wasHouseLeader = houseLeaderBefore === personId
      const personPrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, person.houseId)
      const polityRulerBefore = personPrimaryPolityId
        ? getPolityLeader(currentCtx.state, personPrimaryPolityId)
        : undefined
      const wasPolityLeader = polityRulerBefore === personId

      const deadResult = markPersonDead(currentCtx.state, personId)
      const currentState = deadResult.ok ? deadResult.value : currentCtx.state

      // v0.38 §6.3: notable death (house/polity leader) は IMPORTANT_PERSON_DIED に type 昇格し
      //   importance を major にする。同一死亡で PERSON_DIED と両方は emit しない (単一イベント)。
      //   notability は office 剥奪前 (上の wasHouseLeader/wasPolityLeader) でしか正確に取れないため
      //   projection 側 filter ではなく emit 側で分岐する (案A)。
      const isNotableDeath = wasHouseLeader || wasPolityLeader

      const house = currentState.houses[person.houseId]
      const { event, ctx: eventCtx } = createSimEvent(
        { ...currentCtx, state: currentState },
        {
          type: isNotableDeath ? 'IMPORTANT_PERSON_DIED' : 'PERSON_DIED',
          importance: isNotableDeath ? 'major' : 'minor',
          messageKey: 'person.died',
          messageParams: {
            person: nameParam('person', person.nameKey),
            age: person.age,
          },
          entityRefs: [
            entityRef('person', personId, 'deceased', person.nameKey),
            ...(person.houseId
              ? [entityRef('house', person.houseId, 'house', house?.nameKey)]
              : []),
          ],
        },
      )

      currentCtx = {
        ...eventCtx,
        state: currentState,
        events: [...eventCtx.events, event],
        deathsThisTick: [...eventCtx.deathsThisTick, personId],
        deathRolesThisTick: {
          ...eventCtx.deathRolesThisTick,
          [personId]: { wasHouseLeader, wasPolityLeader },
        },
      }
    }
  }

  return currentCtx
}
