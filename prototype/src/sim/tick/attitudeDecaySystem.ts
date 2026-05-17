import type { TickContext } from './context'
import type { PersonId, PopGroupId } from '../types/ids'

export function runAttitudeDecaySystem(ctx: TickContext): TickContext {
  const rate = ctx.config.attitudeMonthlyRetentionRate

  // v013-residual: simple-batch — 全員の attitudes を retention rate 倍する単純畳み込み。将来 decayAllAttitudes() で代替可
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

  // v013-residual: simple-batch — PopGroup 全員の attitudes を retention rate 倍。上記と同様
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
