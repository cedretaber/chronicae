import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { shuffle } from '../rng/rng'
import { movePersonToHouse } from '../mutations/personMutations'
import { setSpouse } from '../mutations/relationshipMutations'
import type { PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { isForbiddenMarriagePair } from '../selectors/kinshipSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import { createLogger } from '../debug/logger'

export function runMarriageSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  const maleCandidates = collectUnmarriedMaleCandidates(currentCtx)
  const femaleCandidates = collectUnmarriedFemaleCandidates(currentCtx)

  const { value: shuffledMales, rng: shuffledRng } = shuffle(currentCtx.rng, maleCandidates)
  currentCtx = { ...currentCtx, rng: shuffledRng }

  const marriedFemales = new Set<PersonId>()

  for (const maleId of shuffledMales) {
    const male = currentCtx.state.persons[maleId]
    if (!male || male.spouseId) continue

    const { value: roll, rng: rollRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rollRng }

    if (roll >= currentCtx.config.marriageYearlyChance) continue

    const eligibleFemales = femaleCandidates
      .filter((fid) => {
        if (marriedFemales.has(fid)) return false
        const fperson = currentCtx.state.persons[fid]
        if (!fperson) return false
        if (fperson.houseId === male.houseId) return false
        if (isForbiddenMarriagePair(male, fperson, currentCtx.state)) return false
        return true
      })
      .filter((fid) => {
        const fperson = currentCtx.state.persons[fid]
        if (!fperson) return false
        const sameCountry = fperson.countryId === male.countryId
        const effectiveChance = sameCountry
          ? currentCtx.config.marriageYearlyChance + currentCtx.config.sameCountryMarriageBonus
          : currentCtx.config.marriageYearlyChance +
            currentCtx.config.differentCountryMarriagePenalty
        const { value: countryRoll, rng: countryRng } = randomFloat(currentCtx.rng)
        currentCtx = { ...currentCtx, rng: countryRng }
        return countryRoll < effectiveChance
      })

    if (eligibleFemales.length === 0) continue

    const { value: shuffledFemales, rng: shuffledRng2 } = shuffle(currentCtx.rng, eligibleFemales)
    currentCtx = { ...currentCtx, rng: shuffledRng2 }

    let chosenFemaleId: PersonId | null = null
    for (const fid of shuffledFemales) {
      const fperson = currentCtx.state.persons[fid]
      if (!fperson || fperson.spouseId || marriedFemales.has(fid)) continue
      chosenFemaleId = fid
      break
    }

    if (!chosenFemaleId) continue

    marriedFemales.add(chosenFemaleId)

    const moveResult = movePersonToHouse(currentCtx.state, chosenFemaleId, male.houseId)
    if (!moveResult.ok) continue
    const spouseResult = setSpouse(moveResult.value, maleId, chosenFemaleId)
    if (!spouseResult.ok) continue

    currentCtx = { ...currentCtx, state: spouseResult.value }

    const malePerson = currentCtx.state.persons[maleId]
    const femalePerson = currentCtx.state.persons[chosenFemaleId]
    if (!malePerson || !femalePerson) continue

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)

    const event: SimEvent = {
      id: eventId,
      year: currentCtx.state.currentYear,
      month: currentCtx.state.currentMonth,
      type: 'MARRIAGE_FORMED',
      importance: 'normal',
      actorIds: [maleId, chosenFemaleId],
      houseIds: [male.houseId],
      countryIds: [male.countryId],
      provinceIds: [],
      summary: malePerson.name + ' married ' + femalePerson.name,
      description: malePerson.name + ' married ' + femalePerson.name,
      reasons: [],
      effects: [],
    }

    currentCtx = {
      ...eventCtx,
      state: currentCtx.state,
      events: [...eventCtx.events, event],
    }

    const log = createLogger(currentCtx.config.debug)
    log.log('MARRIAGE', {
      year: currentCtx.state.currentYear,
      month: currentCtx.state.currentMonth,
      husband: maleId,
      wife: chosenFemaleId,
    })
  }

  return currentCtx
}

function collectUnmarriedMaleCandidates(ctx: TickContext): PersonId[] {
  const maleIds: PersonId[] = []
  for (const personId of Object.keys(ctx.state.persons).sort()) {
    const person = ctx.state.persons[personId as PersonId]
    if (!person) continue
    if (person.sex !== 'male') continue
    if (!person.alive) continue
    if (person.spouseId) continue
    if (person.age < ctx.config.marriageMaleMinAge) continue
    if (person.age > ctx.config.marriageMaleMaxAge) continue
    const house = ctx.state.houses[person.houseId]
    if (!house || !house.active) continue
    maleIds.push(personId as PersonId)
  }
  return maleIds
}

function collectUnmarriedFemaleCandidates(ctx: TickContext): PersonId[] {
  const femaleIds: PersonId[] = []
  for (const personId of Object.keys(ctx.state.persons).sort()) {
    const person = ctx.state.persons[personId as PersonId]
    if (!person) continue
    if (person.sex !== 'female') continue
    if (!person.alive) continue
    if (person.spouseId) continue
    if (person.age < ctx.config.marriageFemaleMinAge) continue
    if (person.age > ctx.config.marriageFemaleMaxAge) continue
    const house = ctx.state.houses[person.houseId]
    if (!house || !house.active) continue
    if (getHouseLeader(ctx.state, house.id) === person.id) continue
    femaleIds.push(personId as PersonId)
  }
  return femaleIds
}
