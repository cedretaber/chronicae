import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { movePersonToHouse } from '../mutations/personMutations'
import type { HouseId, PersonId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { SuccessionCandidate } from '../selectors/successionSelectors'
import type { WorldState } from '../types/world'
import { createLogger } from '../debug/logger'
import { getHouseCohesion } from '../selectors/statusSelectors'

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

  const currentCohesion = getHouseCohesion(ctx.state, house.id)
  if (currentCohesion >= houseSplitCohesionThreshold) {
    log.log('HOUSE_SPLIT', {
      year: ctx.state.currentYear,
      month: ctx.state.currentMonth,
      house: input.houseId,
      cohesion: Math.round(currentCohesion),
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
    splitter.person.legacyPrestige * houseSplitPrestigeFactor +
    splitter.person.stats.martial * houseSplitMartialFactor -
    currentCohesion * houseSplitCohesionFactor

  const { value: roll, rng: rngAfter } = randomFloat(ctx.rng)
  if (roll >= splitChance) {
    log.log('HOUSE_SPLIT', {
      year: ctx.state.currentYear,
      month: ctx.state.currentMonth,
      house: input.houseId,
      cohesion: Math.round(currentCohesion),
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
  // The current house head cannot be pulled into the cadet house — their headId would become stale
  const parentHeadId = house.headId as string
  const newMemberIds: PersonId[] = [splitterPerson.id]

  if (splitterPerson.spouseId !== undefined) {
    const spouse = ctx.state.persons[splitterPerson.spouseId]
    if (
      spouse &&
      spouse.alive &&
      spouse.houseId === input.houseId &&
      (splitterPerson.spouseId as string) !== parentHeadId
    ) {
      newMemberIds.push(spouse.id)
    }
  }

  for (const childId of splitterPerson.childIds) {
    const child = ctx.state.persons[childId]
    if (
      child &&
      child.alive &&
      child.houseId === input.houseId &&
      (childId as string) !== parentHeadId
    ) {
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
    memberIds: [splitterPerson.id],
    headId: splitterPerson.id,
    founderId: splitterPerson.id,
    cadetHouseIds: [],
    legacyPrestige: Math.floor(house.legacyPrestige * 0.5),
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

  const splitProvincesSet = new Set<ProvinceId>(splitProvinces)
  const newParentProvinceIds = parentHouse.provinceIds.filter((pid) => !splitProvincesSet.has(pid))
  const newParentSeatProvinceId: ProvinceId = splitProvincesSet.has(parentHouse.seatProvinceId)
    ? (newParentProvinceIds[0] ?? ('' as ProvinceId))
    : parentHouse.seatProvinceId
  const newParentMemberIds = parentHouse.memberIds.filter((pid) => !familyPersonIds.has(pid))
  const newParentWealth = parentHouse.wealth - newHouseWealth

  const newParentHouse = {
    ...parentHouse,
    provinceIds: newParentProvinceIds,
    seatProvinceId: newParentSeatProvinceId,
    memberIds: newParentMemberIds,
    wealth: newParentWealth,
    cadetHouseIds: [...parentHouse.cadetHouseIds, newHouseId],
    legacyPrestige: Math.floor(parentHouse.legacyPrestige * 0.5),
  }

  const stateWithParentUpdate: WorldState = {
    ...resultCtx.state,
    houses: { ...resultCtx.state.houses, [input.houseId]: newParentHouse },
  }
  resultCtx = { ...resultCtx, state: stateWithParentUpdate }

  const newHouseCountryId = resultCtx.state.houses[newHouseId]?.countryId
  const updatedProvs = { ...resultCtx.state.provinces }
  for (const pid of splitProvinces) {
    const prov = updatedProvs[pid]
    if (!prov) continue
    updatedProvs[pid] = {
      ...prov,
      ownerHouseId: newHouseId,
      countryId: newHouseCountryId ?? prov.countryId,
    }
  }
  resultCtx = { ...resultCtx, state: { ...resultCtx.state, provinces: updatedProvs } }

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
    cohesion: Math.round(currentCohesion),
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
      candidate.person.legacyPrestige * config.houseSplitPrestigeFactor +
      candidate.person.stats.martial * config.houseSplitMartialFactor

    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  return bestCandidate
}
