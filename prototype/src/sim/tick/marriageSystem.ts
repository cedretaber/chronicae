import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { shuffle } from '../rng/rng'
import { movePersonToHouse } from '../mutations/personMutations'
import { setSpouse } from '../mutations/relationshipMutations'
import type { PersonId } from '../types/ids'
import { isForbiddenMarriagePair } from '../selectors/kinshipSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import { createLogger } from '../debug/logger'
import { getPersonPrimaryPolityId } from '../selectors/polityRelations'
import { nameParam, entityRef } from '../types/event'

const MARRIAGE_CALLS_PER_YEAR = 12

export function runMarriageSystem(ctx: TickContext): TickContext {
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

    const chancePerCall = currentCtx.config.marriageYearlyChance / MARRIAGE_CALLS_PER_YEAR
    if (roll >= chancePerCall) continue

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
        const samePolity =
          getPersonPrimaryPolityId(currentCtx.state, male.id) ===
          getPersonPrimaryPolityId(currentCtx.state, fperson.id)
        const bonusPerCall =
          currentCtx.config.samePrimaryPolityMarriageBonus / MARRIAGE_CALLS_PER_YEAR
        const effectiveChance = samePolity ? chancePerCall + bonusPerCall : chancePerCall
        const { value: polityRoll, rng: polityRng } = randomFloat(currentCtx.rng)
        currentCtx = { ...currentCtx, rng: polityRng }
        return polityRoll < effectiveChance
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

    const maleHouse = currentCtx.state.houses[male.houseId]
    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: 'MARRIAGE_FORMED',
      importance: 'normal',
      messageKey: 'marriage.formed',
      messageParams: {
        male: nameParam('person', malePerson.nameKey, malePerson.name),
        female: nameParam('person', femalePerson.nameKey, femalePerson.name),
      },
      entityRefs: [
        entityRef('person', maleId, 'groom', malePerson.nameKey),
        entityRef('person', chosenFemaleId, 'bride', femalePerson.nameKey),
        entityRef('house', male.houseId, 'house', maleHouse?.nameKey),
      ],
    })

    currentCtx = {
      ...eventCtx,
      state: currentCtx.state,
      events: [...eventCtx.events, event],
    }

    const log = createLogger(currentCtx.config.debug)
    log.log('MARRIAGE', {
      year: currentCtx.state.currentYear,
      week: currentCtx.state.currentWeekOfYear,
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
    if (person.kind === 'placeholder') continue
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
    if (person.kind === 'placeholder') continue
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
