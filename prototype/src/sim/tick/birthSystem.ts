import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { createLogger } from '../debug/logger'
import type { PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import { birthChild } from '../mutations/personMutations'
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'
import { inheritAptitudes, sampleAptitudes } from '../selectors/abilitySelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'

const BIRTH_CALLS_PER_YEAR = 12

export function runBirthSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  const livingCount = countLivingPersons(currentCtx.state)
  const birthMultiplier = computeBirthMultiplier(currentCtx.config, livingCount)

  const adultMales = countAdultMales(currentCtx.state)

  for (const personId of Object.keys(currentCtx.state.persons).sort()) {
    const person = currentCtx.state.persons[personId as PersonId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (!person.alive) continue
    if (person.sex !== 'male') continue
    if (person.age < currentCtx.config.fatherMinChildAge) continue
    if (person.age > currentCtx.config.fatherMaxChildAge) continue
    const house = currentCtx.state.houses[person.houseId]
    if (!house || !house.active) continue
    if (person.houseId === (ANONYMOUS_HOUSE_ID as string)) continue

    const { value: birthRoll, rng: rollRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rollRng }

    const birthChance =
      (currentCtx.config.baseBirthChancePerMalePerYear / BIRTH_CALLS_PER_YEAR) * birthMultiplier
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
    const { name: childName, rng: rngAfterName } = pickNameBySex(childSex, rng3)
    currentCtx = { ...currentCtx, rng: rngAfterName }

    const childMother = motherId !== undefined ? currentCtx.state.persons[motherId] : undefined

    let childAptitudes: import('../types/person').AbilityScores
    if (childMother) {
      const { value: apt, rng: aptRng } = inheritAptitudes(
        person,
        childMother,
        currentCtx.rng,
        currentCtx.config,
      )
      childAptitudes = apt
      currentCtx = { ...currentCtx, rng: aptRng }
    } else {
      const { value: apt, rng: aptRng } = sampleAptitudes(currentCtx.rng, currentCtx.config)
      childAptitudes = apt
      currentCtx = { ...currentCtx, rng: aptRng }
    }

    const birthResult = birthChild(currentCtx, {
      fatherId: person.id,
      ...(motherId !== undefined ? { motherId } : {}),
      birthStatus,
      name: childName,
      sex: childSex,
      aptitudes: childAptitudes,
      traits: { ambition: amb1, caution: amb3 },
    })
    if (!birthResult.ok) continue

    const {
      ctx: ctxAfterBirth,
      value: { childId },
    } = birthResult.value
    currentCtx = ctxAfterBirth

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)

    const childPrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, person.houseId)
    const event: SimEvent = {
      id: eventId,
      year: currentCtx.state.currentYear,
      weekOfYear: currentCtx.state.currentWeekOfYear,
      type: 'CHILD_BORN',
      importance: 'minor',
      actorIds: motherId ? [childId, person.id, motherId] : [childId, person.id],
      houseIds: [person.houseId],
      polityIds: childPrimaryPolityId ? [childPrimaryPolityId] : [],
      provinceIds: [],
      holdingIds: [],
      summary: childName + ' was born',
      description: childName + ' was born',
      reasons: [],
      effects: [],
    }

    currentCtx = { ...eventCtx, events: [...eventCtx.events, event] }

    const log = createLogger(currentCtx.config.debug)
    const birthFields: Record<string, string | number | boolean> = {
      year: currentCtx.state.currentYear,
      week: currentCtx.state.currentWeekOfYear,
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
    if (person && person.alive && person.kind !== 'placeholder') count++
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
    if (
      person &&
      person.alive &&
      person.kind !== 'placeholder' &&
      person.sex === 'male' &&
      person.age >= 15
    )
      count++
  }
  return count
}
