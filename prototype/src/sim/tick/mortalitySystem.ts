import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { revokeRole } from '../mutations/assignRole'
import type { PersonId, CountryId } from '../types/ids'
import type { SimEvent } from '../types/event'

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
      const newPersons = { ...currentCtx.state.persons }
      newPersons[personId as PersonId] = { ...person, alive: false }
      let currentState = { ...currentCtx.state, persons: newPersons }

      let roleFound: { countryId: CountryId; role: 'chancellor' | 'general' | 'treasurer' } | null =
        null
      for (const cid of Object.keys(currentState.countries).sort()) {
        const country = currentState.countries[cid as CountryId]
        if (!country) continue
        for (const role of ['chancellor', 'general', 'treasurer'] as const) {
          if (country.roleAssignments[role] === (personId as PersonId)) {
            roleFound = { countryId: cid as CountryId, role }
            break
          }
        }
        if (roleFound) break
      }

      if (roleFound) {
        currentState = revokeRole(currentState, roleFound.countryId, roleFound.role)
      }

      const house = currentState.houses[person.houseId]
      const importance = house?.headId === (personId as PersonId) ? 'normal' : 'minor'

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
