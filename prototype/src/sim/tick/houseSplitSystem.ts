import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { transferProvinceToHouse } from '../mutations/transferProvince'
import { movePersonToHouse } from '../mutations/personMutations'
import type { HouseId, PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { SuccessionCandidate } from '../selectors/successionSelectors'
import type { WorldState } from '../types/world'
import { createLogger } from '../debug/logger'

export type SplitInput = {
  houseId: HouseId
  successorId: PersonId
  splitCandidates: SuccessionCandidate[]
}

export function maybeSplitHouseAfterSuccession(ctx: TickContext, input: SplitInput): TickContext {
  const house = ctx.state.houses[input.houseId]
  if (!house) return ctx

  const {
    houseSplitEnabled,
    minProvincesForHouseSplit,
    houseSplitCohesionThreshold,
    baseHouseSplitChance,
    houseSplitAmbitionFactor,
    houseSplitPrestigeFactor,
    houseSplitMartialFactor,
    houseSplitCohesionFactor,
  } = ctx.config

  const log = createLogger(ctx.config.debug)

  if (!houseSplitEnabled) return ctx
  if (house.provinceIds.length < minProvincesForHouseSplit) return ctx
  if (input.splitCandidates.length < 1) return ctx
  if (house.cohesion >= houseSplitCohesionThreshold) {
    log.log('HOUSE_SPLIT', {
      year: ctx.state.currentYear,
      month: ctx.state.currentMonth,
      house: input.houseId,
      cohesion: Math.round(house.cohesion),
      threshold: houseSplitCohesionThreshold,
      result: 'skipped',
      reason: 'cohesion_too_high',
    })
    return ctx
  }

  const splitter = chooseSplitter(input.splitCandidates, ctx.config)
  if (!splitter) return ctx

  const splitChance =
    baseHouseSplitChance +
    splitter.person.traits.ambition * houseSplitAmbitionFactor +
    splitter.person.prestige * houseSplitPrestigeFactor +
    splitter.person.stats.martial * houseSplitMartialFactor -
    house.cohesion * houseSplitCohesionFactor

  const { value: roll, rng: rngAfter } = randomFloat(ctx.rng)
  if (roll >= splitChance) {
    log.log('HOUSE_SPLIT', {
      year: ctx.state.currentYear,
      month: ctx.state.currentMonth,
      house: input.houseId,
      cohesion: Math.round(house.cohesion),
      threshold: houseSplitCohesionThreshold,
      split_chance: Math.round(splitChance * 100),
      result: 'skipped',
      reason: 'probability',
    })
    return { ...ctx, rng: rngAfter }
  }

  const controlMin = ctx.config.houseSplitControlMin / 100
  const controlMax = ctx.config.houseSplitControlMax / 100
  const { value: controlFraction, rng: rngAfterControl } = randomFloat(rngAfter)
  const F = controlMin + controlFraction * (controlMax - controlMin)

  const sortedProvinceIds = [...house.provinceIds].sort()
  const splitCount = Math.max(1, Math.floor(sortedProvinceIds.length * F))
  const splitProvinces = sortedProvinceIds.slice(sortedProvinceIds.length - splitCount)

  const currentYear = ctx.state.currentYear
  const newHouseId = `h-${input.houseId}-${currentYear}` as HouseId

  const splitterPerson = splitter.person
  const newMemberIds: PersonId[] = [splitterPerson.id]

  if (splitterPerson.spouseId !== undefined) {
    const spouse = ctx.state.persons[splitterPerson.spouseId]
    if (spouse && spouse.alive && spouse.houseId === input.houseId) {
      newMemberIds.push(spouse.id)
    }
  }

  for (const childId of splitterPerson.childIds) {
    const child = ctx.state.persons[childId]
    if (child && child.alive && child.houseId === input.houseId) {
      newMemberIds.push(childId)
    }
  }

  const newHouseWealth = Math.floor(house.wealth * ctx.config.houseSplitWealthShare)
  const firstSplitProvince = splitProvinces[0] ?? house.seatProvinceId

  const newHouse: import('../types/house').House = {
    id: newHouseId,
    name: splitterPerson.name + "'s House",
    active: true,
    countryId: house.countryId,
    provinceIds: splitProvinces,
    memberIds: newMemberIds,
    headId: splitterPerson.id,
    founderId: splitterPerson.id,
    cadetHouseIds: [],
    prestige: Math.floor(house.prestige * 0.5),
    cohesion: 50,
    loyaltyToCountry: house.loyaltyToCountry,
    wealth: newHouseWealth,
    seatProvinceId: firstSplitProvince,
    parentHouseId: house.id,
  }

  const stateWithNewHouse: WorldState = {
    ...ctx.state,
    houses: { ...ctx.state.houses, [newHouseId]: newHouse },
  }
  let resultCtx = { ...ctx, rng: rngAfterControl, state: stateWithNewHouse }

  const familyPersonIds = new Set(newMemberIds)

  const parentHouse = resultCtx.state.houses[input.houseId]
  if (!parentHouse) return resultCtx

  const newParentProvinceIds = parentHouse.provinceIds.filter(
    (pid) => !(splitProvinces as string[]).includes(pid as string),
  )
  const newParentMemberIds = parentHouse.memberIds.filter((pid) => !familyPersonIds.has(pid))
  const newParentWealth = parentHouse.wealth - newHouseWealth

  const newParentHouse = {
    ...parentHouse,
    provinceIds: newParentProvinceIds,
    memberIds: newParentMemberIds,
    wealth: newParentWealth,
    cadetHouseIds: [...parentHouse.cadetHouseIds, newHouseId],
  }

  const stateWithParentUpdate: WorldState = {
    ...resultCtx.state,
    houses: { ...resultCtx.state.houses, [input.houseId]: newParentHouse },
  }
  resultCtx = { ...resultCtx, state: stateWithParentUpdate }

  let chainState = resultCtx.state
  for (const pid of splitProvinces.sort()) {
    chainState = transferProvinceToHouse(chainState, pid, newHouseId)
  }

  resultCtx = { ...resultCtx, state: chainState }

  const splitterPersonCurrent = resultCtx.state.persons[splitterPerson.id]
  if (splitterPersonCurrent) {
    const newPersons = { ...resultCtx.state.persons }
    newPersons[splitterPerson.id] = {
      ...splitterPersonCurrent,
      houseId: newHouseId,
      countryId: resultCtx.state.houses[newHouseId]?.countryId ?? splitterPersonCurrent.countryId,
    }
    resultCtx = { ...resultCtx, state: { ...resultCtx.state, persons: newPersons } }
  }

  for (const personId of newMemberIds) {
    if (personId === splitterPerson.id) continue
    const movedState = movePersonToHouse(resultCtx.state, personId, newHouseId)
    resultCtx = { ...resultCtx, state: movedState }
  }

  const country = resultCtx.state.countries[house.countryId]
  if (country) {
    const newCountries = { ...resultCtx.state.countries }
    newCountries[house.countryId] = {
      ...country,
      houseIds: [...country.houseIds, newHouseId],
    }
    resultCtx = { ...resultCtx, state: { ...resultCtx.state, countries: newCountries } }
  }

  const { id: eventId, ctx: eventCtx } = makeEventId(resultCtx)
  const splitEvent: SimEvent = {
    id: eventId,
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    type: 'HOUSE_SPLIT',
    importance: 'major',
    actorIds: [splitterPerson.id],
    houseIds: [input.houseId, newHouseId],
    countryIds: [house.countryId],
    provinceIds: splitProvinces,
    summary: `${splitterPerson.name} has split from ${house.name} to form a new house.`,
    reasons: [],
    effects: [],
  }
  resultCtx = { ...eventCtx, state: resultCtx.state, events: [...eventCtx.events, splitEvent] }

  log.log('HOUSE_SPLIT', {
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    house: input.houseId,
    cohesion: Math.round(house.cohesion),
    threshold: houseSplitCohesionThreshold,
    result: 'split',
    new_house: newHouseId,
  })

  const { id: crisisId, ctx: crisisCtx } = makeEventId(resultCtx)
  const crisisEvent: SimEvent = {
    id: crisisId,
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    type: 'SUCCESSION_CRISIS',
    importance: 'major',
    actorIds: [splitterPerson.id],
    houseIds: [input.houseId],
    countryIds: [house.countryId],
    provinceIds: [],
    summary: `A succession crisis has erupted due to the house split!`,
    reasons: [],
    effects: [],
  }
  resultCtx = { ...crisisCtx, state: resultCtx.state, events: [...crisisCtx.events, crisisEvent] }

  return resultCtx
}

function chooseSplitter(
  candidates: SuccessionCandidate[],
  config: import('../config/defaultConfig').SimulationConfig,
): SuccessionCandidate | null {
  let bestCandidate: SuccessionCandidate | null = null
  let bestScore = -Infinity

  for (const candidate of candidates) {
    const score =
      candidate.person.traits.ambition * config.houseSplitAmbitionFactor +
      candidate.person.prestige * config.houseSplitPrestigeFactor +
      candidate.person.stats.martial * config.houseSplitMartialFactor

    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}
