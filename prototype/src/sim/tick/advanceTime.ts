import type { TickContext } from './context'
import type { PersonId } from '../types/ids'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'

export function advanceTime(ctx: TickContext): TickContext {
  const nextAbsoluteWeek = ctx.state.absoluteWeek + 1
  const nextWeekOfYear = (nextAbsoluteWeek % WEEKS_PER_YEAR) + 1
  const nextYear = Math.floor(nextAbsoluteWeek / WEEKS_PER_YEAR)

  if (nextWeekOfYear === 1) {
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
        absoluteWeek: nextAbsoluteWeek,
        currentWeekOfYear: nextWeekOfYear,
        currentYear: nextYear,
      },
      deathsThisTick: [],
      deathRolesThisTick: {},
    }
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      absoluteWeek: nextAbsoluteWeek,
      currentWeekOfYear: nextWeekOfYear,
      currentYear: nextYear,
    },
    deathsThisTick: [],
    deathRolesThisTick: {},
  }
}
