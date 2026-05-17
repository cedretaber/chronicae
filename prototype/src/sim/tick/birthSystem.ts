import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat, randomInt } from '../rng/rng'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { createLogger } from '../debug/logger'
import type { PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { birthChild } from '../mutations/personMutations'

export function runBirthSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  const livingCount = countLivingPersons(currentCtx.state)
  const birthMultiplier = computeBirthMultiplier(currentCtx.config, livingCount)

  const adultMales = countAdultMales(currentCtx.state)

  for (const personId of Object.keys(currentCtx.state.persons).sort()) {
    const person = currentCtx.state.persons[personId as PersonId]
    if (!person) continue
    if (!person.alive) continue
    if (person.sex !== 'male') continue
    if (person.age < currentCtx.config.fatherMinChildAge) continue
    if (person.age > currentCtx.config.fatherMaxChildAge) continue
    const house = currentCtx.state.houses[person.houseId]
    if (!house || !house.active) continue

    const { value: birthRoll, rng: rollRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rollRng }

    const birthChance = currentCtx.config.baseBirthChancePerMalePerYear * birthMultiplier
    if (birthRoll >= birthChance) continue

    let motherId: PersonId | undefined = undefined
    let birthStatus: 'legitimate' | 'illegitimate' = 'illegitimate'

    if (person.spouseId) {
      const spouse = currentCtx.state.persons[person.spouseId]
      if (
        spouse &&
        spouse.alive &&
        spouse.sex === 'female' &&
        spouse.age >= currentCtx.config.motherMinChildAge &&
        spouse.age <= currentCtx.config.motherMaxChildAge
      ) {
        const { value: spouseRoll, rng: spouseRng } = randomFloat(currentCtx.rng)
        currentCtx = { ...currentCtx, rng: spouseRng }
        if (spouseRoll < currentCtx.config.spouseMotherChance) {
          motherId = person.spouseId
          birthStatus = 'legitimate'
        }
      }
    }

    const totalLiving = countLivingPersons(currentCtx.state)
    let sexRoll: number
    {
      const { value: sr, rng: srRng } = randomFloat(currentCtx.rng)
      sexRoll = sr
      currentCtx = { ...currentCtx, rng: srRng }
    }
    const sex =
      adultMales < totalLiving * 0.4
        ? currentCtx.config.maleBirthChanceWhenAdultMaleShortage
        : currentCtx.config.maleBirthChance

    const childSex = sexRoll < sex ? 'male' : 'female'

    const { value: amb1, rng: rng1 } = randomFloat(currentCtx.rng)
    const { value: amb3, rng: rng3 } = randomFloat(rng1)
    const { value: adminStat, rng: rng4 } = randomInt(rng3, 1, 8)
    const { value: martialStat, rng: rng5 } = randomInt(rng4, 1, 8)
    const { name: childName, rng: rngAfterName } = pickNameBySex(childSex, rng5)
    currentCtx = { ...currentCtx, rng: rngAfterName }

    const birthResult = birthChild(currentCtx, {
      fatherId: person.id,
      ...(motherId !== undefined ? { motherId } : {}),
      birthStatus,
      name: childName,
      sex: childSex,
      stats: { admin: adminStat, martial: martialStat },
      traits: { ambition: amb1, caution: amb3 },
    })
    if (!birthResult.ok) continue

    const {
      ctx: ctxAfterBirth,
      value: { childId },
    } = birthResult.value
    currentCtx = ctxAfterBirth

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)

    const event: SimEvent = {
      id: eventId,
      year: currentCtx.state.currentYear,
      month: currentCtx.state.currentMonth,
      type: 'CHILD_BORN',
      importance: 'minor',
      actorIds: motherId ? [childId, person.id, motherId] : [childId, person.id],
      houseIds: [person.houseId],
      countryIds: [person.countryId],
      provinceIds: [],
      summary: childName + ' was born',
      description: childName + ' was born',
      reasons: [],
      effects: [],
    }

    currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }

    const log = createLogger(currentCtx.config.debug)
    const birthFields: Record<string, string | number | boolean> = {
      year: currentCtx.state.currentYear,
      month: currentCtx.state.currentMonth,
      child: childId,
      sex: childSex,
      father: person.id,
      status: birthStatus,
    }
    if (motherId) birthFields['mother'] = motherId
    log.log('BIRTH', birthFields)
  }

  return currentCtx
}

function countLivingPersons(state: WorldState): number {
  let count = 0
  for (const person of Object.values(state.persons)) {
    if (person && person.alive) count++
  }
  return count
}

function computeBirthMultiplier(config: SimulationConfig, livingCount: number): number {
  if (livingCount <= config.criticalLivingPersons) return config.criticalPopulationBirthMultiplier
  if (livingCount < config.targetLivingPersons) return config.lowPopulationBirthMultiplier
  return 1.0
}

function countAdultMales(state: WorldState): number {
  let count = 0
  for (const person of Object.values(state.persons)) {
    if (person && person.alive && person.sex === 'male' && person.age >= 15) count++
  }
  return count
}
