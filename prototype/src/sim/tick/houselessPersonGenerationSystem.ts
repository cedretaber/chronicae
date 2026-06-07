import type { TickContext } from './context'
import { makePersonId, createSimEvent } from './context'
import type { PersonId } from '../types/ids'
import type { Person, PersonBackgroundOccupation } from '../types/person'
import { nameParam, entityRef } from '../types/event'
import { randomInt, randomFloat } from '../rng/rng'
import type { RngState } from '../rng/rng'
import { samplePerson } from '../helpers/personFactory'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { addHouselessPerson } from '../mutations/houseMutations'
import { markPersonDead } from '../mutations/personMutations'
import { getHouselessPersons } from '../selectors/availabilitySelectors'
import { getActiveFactionMembership } from '../selectors/factionSelectors'

// v0.17 §5.4: HouselessPersonGenerationSystem
// Every January, maintain houseless Person count via birth and fading.
function computeEffectiveTargets(ctx: TickContext): {
  target: number
  softMax: number
  hardMax: number
} {
  const holdingsCount = Object.keys(ctx.state.holdings).length
  const target = Math.ceil(holdingsCount * ctx.config.houselessPersonsPerHolding)
  const softMax = Math.ceil(target * 1.5)
  const hardMax = target * 2
  return { target, softMax, hardMax }
}

export function runHouselessPersonGenerationSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const { target, softMax, hardMax } = computeEffectiveTargets(ctx)

  const houselessIds = getHouselessPersons(currentCtx.state)
  const count = houselessIds.length

  // 1. Create if below target
  if (count < target) {
    const toCreate = target - count
    for (let i = 0; i < toCreate; i++) {
      currentCtx = createHouselessPerson(currentCtx)
    }
  }

  // 2. Prune if above softMax
  const afterCreateIds = getHouselessPersons(currentCtx.state)
  const afterCreateCount = afterCreateIds.length
  if (afterCreateCount > softMax) {
    const targetReduction =
      afterCreateCount > hardMax
        ? afterCreateCount - softMax
        : Math.floor((afterCreateCount - softMax) / 2)
    currentCtx = pruneHouseless(currentCtx, targetReduction)
  }

  return currentCtx
}

function createHouselessPerson(ctx: TickContext): TickContext {
  const config = ctx.config
  let rng: RngState = ctx.rng

  // 1. Age: adultAge .. 40
  const { value: age, rng: rngAfterAge } = randomInt(rng, config.adultAge, 40)
  rng = rngAfterAge

  // 2. Sex: 50/50
  const { value: sexRoll, rng: rngAfterSex } = randomFloat(rng)
  rng = rngAfterSex
  const sex: 'male' | 'female' = sexRoll < config.houselessMaleRatio ? 'male' : 'female'

  // 3. Name
  let nameKey: string
  if (ctx.namePoolService) {
    const { value: key, rng: rngAfterName } = ctx.namePoolService.pickNameKey(rng, {
      nameCultureId: ctx.config.nameCultureId,
      category: 'person',
      path: [sex === 'male' ? 'male' : 'female'],
    })
    rng = rngAfterName
    nameKey = key
  } else {
    const { name: n, rng: rngAfterName } = pickNameBySex(sex, rng)
    rng = rngAfterName
    nameKey = n
  }

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

  // 8. Build Person via samplePerson (no houseId — person is houseless)
  const { value: person, rng: rngAfterSample } = samplePerson(ctxWithId.rng, ctxWithId.config, {
    id: personId,
    nameKey,
    sex,
    age,
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

  // 10. Add as houseless person
  const addResult = addHouselessPerson(ctxWithId.state, personWithExtras)
  if (!addResult.ok) {
    return { ...ctxWithId, rng: rngAfterSample }
  }

  let newCtx: TickContext = { ...ctxWithId, rng: rngAfterSample, state: addResult.value }

  // 11. PERSON_BORN_IN_OBSCURITY event
  const { event, ctx: ec } = createSimEvent(newCtx, {
    type: 'PERSON_BORN_IN_OBSCURITY',
    importance: 'minor',
    messageKey: 'person.born_in_obscurity',
    messageParams: {
      occupation,
      person: nameParam('person', nameKey),
    },
    entityRefs: [entityRef('person', personId, 'person', nameKey)],
  })
  newCtx = { ...ec, events: [...ec.events, event] }

  return newCtx
}

function sampleOccupation(
  rng: RngState,
  weights: Record<PersonBackgroundOccupation, number>,
): { occupation: PersonBackgroundOccupation; rng: RngState } {
  const entries = (Object.keys(weights) as PersonBackgroundOccupation[]).map((k) => ({
    key: k,
    weight: weights[k] ?? 0,
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

function pruneHouseless(ctx: TickContext, targetReduction: number): TickContext {
  if (targetReduction <= 0) return ctx
  const config = ctx.config
  const currentYear = ctx.state.currentYear

  const candidates: { personId: PersonId; score: number }[] = []
  for (const pid of getHouselessPersons(ctx.state)) {
    const p = ctx.state.persons[pid]
    if (!p) continue

    const dwell = currentYear - (p.lastHouseTransferYear ?? currentYear)

    // Exclusion checks
    // v0.45.1: 天才は「歴史から消える」対象にしない (notable 人物の無言消滅を防ぐ。
    //   自然死は mortalitySystem 側で在野にも適用されるため不死にはならない)
    if (p.geniusType !== undefined) continue
    if (dwell < config.houselessProtectionYears) continue
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

    const { event, ctx: ec } = createSimEvent(currentCtx, {
      type: 'PERSON_FADED_FROM_HISTORY',
      importance: 'minor',
      messageKey: 'person.faded_from_history',
      messageParams: {
        person: nameParam('person', person.nameKey),
      },
      entityRefs: [entityRef('person', personId, 'person', person.nameKey)],
    })
    currentCtx = { ...ec, events: [...ec.events, event] }
  }

  return currentCtx
}
