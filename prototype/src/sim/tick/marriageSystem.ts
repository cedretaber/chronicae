import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { shuffle } from '../rng/rng'
import { movePersonToHouse } from '../mutations/personMutations'
import { setSpouse } from '../mutations/relationshipMutations'
import type { PersonId, HouseId } from '../types/ids'
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
        if (!male.houseId && !fperson.houseId) return false
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

    const chosenFemale = currentCtx.state.persons[chosenFemaleId]
    if (!chosenFemale) continue

    let targetHouseId: HouseId
    let personToMoveId: PersonId

    if (male.houseId) {
      // Case 1 & 3: male has house → female joins male's house
      targetHouseId = male.houseId
      personToMoveId = chosenFemaleId
    } else if (chosenFemale.houseId) {
      // Case 2: male houseless, female has house → male joins female's house
      targetHouseId = chosenFemale.houseId
      personToMoveId = maleId
    } else {
      // Case 4: both houseless → skip
      continue
    }

    marriedFemales.add(chosenFemaleId)

    const moveResult = movePersonToHouse(currentCtx.state, personToMoveId, targetHouseId)
    if (!moveResult.ok) continue
    const spouseResult = setSpouse(moveResult.value, maleId, chosenFemaleId)
    if (!spouseResult.ok) continue

    currentCtx = { ...currentCtx, state: spouseResult.value }

    const malePerson = currentCtx.state.persons[maleId]
    const femalePerson = currentCtx.state.persons[chosenFemaleId]
    if (!malePerson || !femalePerson) continue

    const targetHouse = currentCtx.state.houses[targetHouseId]
    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: 'MARRIAGE_FORMED',
      importance: 'normal',
      messageKey: 'marriage.formed',
      messageParams: {
        male: nameParam('person', malePerson.nameKey),
        female: nameParam('person', femalePerson.nameKey),
      },
      entityRefs: [
        entityRef('person', maleId, 'groom', malePerson.nameKey),
        entityRef('person', chosenFemaleId, 'bride', femalePerson.nameKey),
        entityRef('house', targetHouseId, 'house', targetHouse?.nameKey),
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
  for (const personId of ctx.state.livingPersonIds) {
    const person = ctx.state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (person.sex !== 'male') continue
    if (person.spouseId) continue
    if (person.age < ctx.config.marriageMaleMinAge) continue
    if (person.age > ctx.config.marriageMaleMaxAge) continue
    if (person.houseId) {
      const house = ctx.state.houses[person.houseId]
      if (!house || !house.active) continue
    }
    maleIds.push(personId)
  }
  return maleIds
}

function collectUnmarriedFemaleCandidates(ctx: TickContext): PersonId[] {
  const femaleIds: PersonId[] = []
  for (const personId of ctx.state.livingPersonIds) {
    const person = ctx.state.persons[personId]
    if (!person) continue
    if (person.kind === 'placeholder') continue
    if (person.sex !== 'female') continue
    if (person.spouseId) continue
    if (person.age < ctx.config.marriageFemaleMinAge) continue
    if (person.age > ctx.config.marriageFemaleMaxAge) continue
    if (person.houseId) {
      const house = ctx.state.houses[person.houseId]
      if (!house || !house.active) continue
      if (getHouseLeader(ctx.state, house.id) === person.id) continue
    }
    femaleIds.push(personId)
  }
  return femaleIds
}
