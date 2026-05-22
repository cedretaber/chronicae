import type { TickContext } from './context'
import type { PersonId } from '../types/ids'
import type { AbilityScores, AbilityKey } from '../types/person'
import { ABILITY_KEYS, ABILITY_AGE_CURVES, ABILITY_HARD_CAP } from '../constants/abilityConstants'
import { naturalFraction, hadRelevantExperience } from '../selectors/abilitySelectors'
import { randomFloat } from '../rng/rng'

export function runPersonGrowthSystem(ctx: TickContext): TickContext {
  let rng = ctx.rng
  const updatedPersons: Record<PersonId, AbilityScores> = {}

  for (const personId of Object.keys(ctx.state.persons).sort()) {
    const person = ctx.state.persons[personId as PersonId]
    if (!person || !person.alive) continue
    if (person.kind === 'placeholder') continue

    let changed = false
    const newAbilities: AbilityScores = { ...person.abilities }

    for (const k of ABILITY_KEYS) {
      const ability = newAbilities[k]
      const aptitude = person.aptitudes[k]

      const naturalCeil = aptitude * naturalFraction(k, person.age, ctx.config)
      const effectiveCeil = hadRelevantExperience(ctx.state, person.id, k) ? aptitude : naturalCeil

      let grew = false

      // Growth
      if (ability < effectiveCeil && effectiveCeil > 0) {
        let gainChance = ctx.config.abilityGrowthChanceBase * (1 - ability / effectiveCeil)
        const personExp = ctx.state.personTrainingExperience[person.id]
        const trainingExp = personExp ? ((personExp as Record<string, number>)[k] ?? 0) : 0
        if (trainingExp > 0) {
          gainChance += trainingExp * 0.05
        }
        const { value: roll, rng: nextRng } = randomFloat(rng)
        rng = nextRng
        if (roll < gainChance / 100) {
          newAbilities[k] = Math.min(ability + 1, ABILITY_HARD_CAP)
          changed = true
          grew = true
        }
      }

      // Decline (only if no growth this step)
      if (!grew) {
        const curve = ABILITY_AGE_CURVES[k]
        if (ability > naturalCeil && (curve === 'youthPeak' || curve === 'midLifePeak')) {
          let declineChance = ctx.config.abilityDeclineChanceBase
          if (hadRelevantExperience(ctx.state, person.id, k)) {
            declineChance *= ctx.config.abilityActiveDeclineMultiplier
          }
          const { value: roll, rng: nextRng } = randomFloat(rng)
          rng = nextRng
          if (roll < declineChance / 100) {
            newAbilities[k] = Math.max(ability - 1, 0)
            changed = true
          }
        }
      }
    }

    // Decay training experience for this person
    {
      const existingExp = ctx.state.personTrainingExperience[person.id]
      if (existingExp) {
        const decayed: Partial<Record<AbilityKey, number>> = {}
        let hasAny = false
        for (const [ek, ev] of Object.entries(existingExp) as [AbilityKey, number][]) {
          const newVal = ev * ctx.config.trainingExperienceDecayRate
          if (newVal >= 0.1) {
            decayed[ek] = newVal
            hasAny = true
          }
        }
        if (hasAny) {
          ctx = {
            ...ctx,
            state: {
              ...ctx.state,
              personTrainingExperience: {
                ...ctx.state.personTrainingExperience,
                [person.id]: decayed,
              },
            },
          }
        } else {
          ctx = {
            ...ctx,
            state: {
              ...ctx.state,
              personTrainingExperience: {
                ...ctx.state.personTrainingExperience,
                [person.id]: {},
              },
            },
          }
        }
      }
    }

    if (changed) {
      updatedPersons[person.id] = newAbilities
    }
  }

  if (Object.keys(updatedPersons).length === 0) {
    return { ...ctx, rng }
  }

  const newPersons = { ...ctx.state.persons }
  for (const [id, abilities] of Object.entries(updatedPersons)) {
    const pid = id as PersonId
    const person = newPersons[pid]
    if (person) {
      newPersons[pid] = { ...person, abilities }
    }
  }

  return {
    ...ctx,
    rng,
    state: { ...ctx.state, persons: newPersons },
  }
}
