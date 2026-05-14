import type { TickContext } from './context'
import { makeEventId, makePersonId } from './context'
import { randomFloat, randomInt } from '../rng/rng'
import type { PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { Person } from '../types/person'
import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'

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
    const { value: amb2, rng: rng2 } = randomFloat(rng1)
    const { value: amb3, rng: rng3 } = randomFloat(rng2)
    const { value: adminStat, rng: rng4 } = randomInt(rng3, 1, 8)
    const { value: martialStat, rng: rng5 } = randomInt(rng4, 1, 8)
    currentCtx = { ...currentCtx, rng: rng5 }

    const { id: childId, ctx: personCtx } = makePersonId(currentCtx)

    const childPerson: Person = {
      id: childId,
      name: 'Child-' + childId,
      sex: childSex,
      age: 0,
      alive: true,
      houseId: person.houseId,
      countryId: person.countryId,
      fatherId: person.id,
      birthStatus,
      childIds: [],
      stats: {
        admin: adminStat,
        martial: martialStat,
      },
      traits: {
        ambition: amb1,
        loyaltyToCountry: amb2,
        caution: amb3,
      },
      prestige: 0,
    }

    let newPersons: Record<PersonId, Person> = {
      ...personCtx.state.persons,
      [childId]: childPerson,
    }

    const newFather = newPersons[person.id]
    if (newFather) {
      newPersons = {
        ...newPersons,
        [person.id]: { ...newFather, childIds: [...newFather.childIds, childId] },
      }
    }

    if (motherId) {
      const newMother = newPersons[motherId]
      if (newMother) {
        newPersons = {
          ...newPersons,
          [motherId]: { ...newMother, childIds: [...newMother.childIds, childId] },
        }
      }
    }

    const newState = { ...personCtx.state, persons: newPersons }
    currentCtx = { ...personCtx, state: newState }

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)

    const event: SimEvent = {
      id: eventId,
      year: newState.currentYear,
      month: newState.currentMonth,
      type: 'CHILD_BORN',
      importance: 'minor',
      actorIds: motherId ? [childId, person.id, motherId] : [childId, person.id],
      houseIds: [person.houseId],
      countryIds: [person.countryId],
      provinceIds: [],
      summary: 'Child-' + childId + ' was born',
      description: 'Child-' + childId + ' was born',
      reasons: [],
      effects: [],
    }

    currentCtx = {
      ...eventCtx,
      state: newState,
      events: [...eventCtx.events, event],
    }
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
