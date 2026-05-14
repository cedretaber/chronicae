import type { TickContext } from './context'
import type { PersonId } from '../types/ids'

export function advanceTime(ctx: TickContext): TickContext {
  const newMonth = ctx.state.currentMonth + 1
  if (newMonth > 12) {
    const newPersons = { ...ctx.state.persons }
    for (const personId of Object.keys(ctx.state.persons)) {
      const person = newPersons[personId as PersonId]
      if (!person) continue
      newPersons[personId as PersonId] = { ...person, age: person.age + 1 }
    }
    return {
      ...ctx,
      state: {
        ...ctx.state,
        persons: newPersons,
        currentYear: ctx.state.currentYear + 1,
        currentMonth: 1,
      },
    }
  }
  return {
    ...ctx,
    state: {
      ...ctx.state,
      currentMonth: newMonth,
    },
  }
}
