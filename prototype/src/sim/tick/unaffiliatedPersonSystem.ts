import type { TickContext } from './context'
import { makePersonId, makeEventId } from './context'
import type { PersonId } from '../types/ids'
import type { Person, UnaffiliatedOccupation } from '../types/person'
import type { SimEvent } from '../types/event'
import { ANONYMOUS_HOUSE_ID } from '../types/house'
import { randomInt, randomFloat } from '../rng/rng'
import type { RngState } from '../rng/rng'
import { samplePerson } from '../helpers/personFactory'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { addPersonToAnonymousHouse } from '../mutations/houseMutations'
import { markPersonDead } from '../mutations/personMutations'
import { getUnaffiliatedPersons } from '../selectors/availabilitySelectors'
import { getActiveFactionMembership } from '../selectors/factionSelectors'

// v0.17 §5.4: UnaffiliatedPersonSystem
// Every January, maintain AnonymousHouse normal Person count via birth and fading.
function computeEffectiveTargets(ctx: TickContext): {
  target: number
  softMax: number
  hardMax: number
} {
  const holdingsCount = Object.keys(ctx.state.holdings).length
  const holdingsBased = Math.ceil(holdingsCount * ctx.config.unaffiliatedPersonsPerHolding)
  const target = Math.max(ctx.config.targetUnaffiliatedPersons, holdingsBased)
  const softMax = Math.max(ctx.config.softMaxUnaffiliatedPersons, Math.ceil(target * 1.5))
  const hardMax = Math.max(ctx.config.hardMaxUnaffiliatedPersons, target * 2)
  return { target, softMax, hardMax }
}

export function runUnaffiliatedPersonSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const { target, softMax, hardMax } = computeEffectiveTargets(ctx)

  const unaffiliatedIds = getUnaffiliatedPersons(currentCtx.state)
  const count = unaffiliatedIds.length

  // 1. Create if below target
  if (count < target) {
    const toCreate = target - count
    for (let i = 0; i < toCreate; i++) {
      currentCtx = createUnaffiliatedPerson(currentCtx)
    }
  }

  // 2. Prune if above softMax
  const afterCreateIds = getUnaffiliatedPersons(currentCtx.state)
  const afterCreateCount = afterCreateIds.length
  if (afterCreateCount > softMax) {
    const targetReduction =
      afterCreateCount > hardMax
        ? afterCreateCount - softMax
        : Math.floor((afterCreateCount - softMax) / 2)
    currentCtx = pruneUnaffiliated(currentCtx, targetReduction)
  }

  return currentCtx
}

function createUnaffiliatedPerson(ctx: TickContext): TickContext {
  const config = ctx.config
  let rng: RngState = ctx.rng

  // 1. Age: adultAge .. 40
  const { value: age, rng: rngAfterAge } = randomInt(rng, config.adultAge, 40)
  rng = rngAfterAge

  // 2. Sex: 50/50
  const { value: sexRoll, rng: rngAfterSex } = randomFloat(rng)
  rng = rngAfterSex
  const sex: 'male' | 'female' = sexRoll < 0.5 ? 'male' : 'female'

  // 3. Name
  const { name, rng: rngAfterName } = pickNameBySex(sex, rng)
  rng = rngAfterName

  // 4. Occupation (weighted)
  const { occupation, rng: rngAfterOccupation } = sampleOccupation(rng, config.occupationWeights)
  rng = rngAfterOccupation

  // 5. Legacy prestige: 0-20
  const { value: prestige, rng: rngAfterPrestige } = randomInt(rng, 0, 20)
  rng = rngAfterPrestige

  // 6. Traits: ambition, caution (0.0-1.0)
  const { value: ambitionRoll, rng: rngAfterAmbition } = randomFloat(rng)
  rng = rngAfterAmbition
  const { value: cautionRoll, rng: rngAfterCaution } = randomFloat(rng)
  rng = rngAfterCaution

  // 7. Allocate PersonId
  const ctxWithRng = { ...ctx, rng }
  const { id: personId, ctx: ctxWithId } = makePersonId(ctxWithRng)

  // 8. Build Person via samplePerson
  const { value: person, rng: rngAfterSample } = samplePerson(ctxWithId.rng, ctxWithId.config, {
    id: personId,
    name,
    sex,
    age,
    houseId: ANONYMOUS_HOUSE_ID,
    birthStatus: 'unknown',
    traits: { ambition: ambitionRoll, caution: cautionRoll },
    legacyPrestige: prestige,
    wealth: 0,
  })

  // 9. Add occupation and lastHouseTransferYear (samplePerson does not set these)
  const personWithExtras: Person = {
    ...person,
    occupation,
    lastHouseTransferYear: ctxWithId.state.currentYear,
  }

  // 10. Add to AnonymousHouse
  const addResult = addPersonToAnonymousHouse(ctxWithId.state, { person: personWithExtras })
  if (!addResult.ok) {
    return { ...ctxWithId, rng: rngAfterSample }
  }

  let newCtx: TickContext = { ...ctxWithId, rng: rngAfterSample, state: addResult.value }

  // 11. PERSON_BORN_IN_OBSCURITY event
  const { id: eventId, ctx: ec } = makeEventId(newCtx)
  const event: SimEvent = {
    id: eventId,
    year: ec.state.currentYear,
    weekOfYear: ec.state.currentWeekOfYear,
    type: 'PERSON_BORN_IN_OBSCURITY',
    importance: 'minor',
    actorIds: [personId],
    houseIds: [ANONYMOUS_HOUSE_ID],
    polityIds: [],
    provinceIds: [],
    holdingIds: [],
    summary: `An unknown ${occupation} named ${name} appeared.`,
    reasons: [],
    effects: [],
  }
  newCtx = { ...ec, events: [...ec.events, event] }

  return newCtx
}

function sampleOccupation(
  rng: RngState,
  weights: Record<UnaffiliatedOccupation, number>,
): { occupation: UnaffiliatedOccupation; rng: RngState } {
  const entries = (Object.keys(weights) as UnaffiliatedOccupation[]).map((k) => ({
    key: k,
    weight: weights[k],
  }))
  const total = entries.reduce((s, e) => s + e.weight, 0)
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let acc = 0
  const threshold = roll * total
  for (const e of entries) {
    acc += e.weight
    if (acc >= threshold) return { occupation: e.key, rng: nextRng }
  }
  return { occupation: 'wanderer', rng: nextRng }
}

function pruneUnaffiliated(ctx: TickContext, targetReduction: number): TickContext {
  if (targetReduction <= 0) return ctx
  const config = ctx.config
  const currentYear = ctx.state.currentYear

  const candidates: { personId: PersonId; score: number }[] = []
  for (const pid of getUnaffiliatedPersons(ctx.state)) {
    const p = ctx.state.persons[pid]
    if (!p) continue

    const dwell = currentYear - (p.lastHouseTransferYear ?? currentYear)

    // Exclusion checks
    if (dwell < config.unaffiliatedProtectionYears) continue
    if (p.legacyPrestige >= config.protectionPrestigeThreshold) continue
    const officeIds = ctx.state.officeIndex.byHolderPerson[pid] ?? []
    let hasActiveOffice = false
    for (const oid of officeIds) {
      const o = ctx.state.officeAssignments[oid]
      if (o && o.active) {
        hasActiveOffice = true
        break
      }
    }
    if (hasActiveOffice) continue
    if (getActiveFactionMembership(ctx.state, pid)) continue

    // Qualification checks
    if (dwell <= config.pruningMinDwellYears) continue
    if (p.legacyPrestige >= config.pruningPrestigeThreshold) continue
    if (p.wealth >= config.pruningWealthThreshold) continue

    // Score: high dwell + low prestige = higher priority to prune
    const score = dwell - p.legacyPrestige
    candidates.push({ personId: pid, score })
  }
  candidates.sort((a, b) => b.score - a.score)
  const toPrune = candidates.slice(0, targetReduction)

  let currentCtx = ctx
  for (const { personId } of toPrune) {
    const person = currentCtx.state.persons[personId]
    if (!person || !person.alive) continue
    const deadResult = markPersonDead(currentCtx.state, personId, {
      deathCircumstance: 'faded_from_history',
    })
    if (!deadResult.ok) continue
    currentCtx = { ...currentCtx, state: deadResult.value }

    const { id: eventId, ctx: ec } = makeEventId(currentCtx)
    const event: SimEvent = {
      id: eventId,
      year: ec.state.currentYear,
      weekOfYear: ec.state.currentWeekOfYear,
      type: 'PERSON_FADED_FROM_HISTORY',
      importance: 'minor',
      actorIds: [personId],
      houseIds: [ANONYMOUS_HOUSE_ID],
      polityIds: [],
      provinceIds: [],
      holdingIds: [],
      summary: `${person.name} faded from the chronicles.`,
      reasons: [],
      effects: [],
    }
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  return currentCtx
}
