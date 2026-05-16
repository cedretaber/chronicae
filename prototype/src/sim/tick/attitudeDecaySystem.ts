import type { TickContext } from './context'
import type { PersonId, PopGroupId } from '../types/ids'

export function runAttitudeDecaySystem(ctx: TickContext): TickContext {
  const rate = ctx.config.attitudeMonthlyRetentionRate

  // Decay all Person attitudes toward 0 by multiplying by retention rate
  const newPersons = { ...ctx.state.persons }
  for (const personId of Object.keys(newPersons).sort() as PersonId[]) {
    const person = newPersons[personId]
    if (!person || !person.alive) continue

    const hasAnyAttitude = Object.keys(person.attitudes).length > 0
    if (!hasAnyAttitude) continue

    const decayedAttitudes: typeof person.attitudes = {}
    for (const [key, att] of Object.entries(person.attitudes)) {
      decayedAttitudes[key] = {
        affection: att.affection * rate,
        respect: att.respect * rate,
      }
    }
    newPersons[personId] = { ...person, attitudes: decayedAttitudes }
  }

  // Decay all PopGroup attitudes toward 0 by multiplying by retention rate
  const newPopGroups = { ...ctx.state.popGroups }
  for (const popId of Object.keys(newPopGroups).sort() as PopGroupId[]) {
    const pop = newPopGroups[popId]
    if (!pop) continue

    const hasAnyAttitude = Object.keys(pop.attitudes).length > 0
    if (!hasAnyAttitude) continue

    const decayedAttitudes: typeof pop.attitudes = {}
    for (const [key, att] of Object.entries(pop.attitudes)) {
      decayedAttitudes[key] = {
        affection: att.affection * rate,
        respect: att.respect * rate,
      }
    }
    newPopGroups[popId] = { ...pop, attitudes: decayedAttitudes }
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      persons: newPersons,
      popGroups: newPopGroups,
    },
  }
}
