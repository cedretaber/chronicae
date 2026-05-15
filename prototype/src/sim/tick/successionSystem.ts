import type { TickContext } from './context'
import { makeEventId } from './context'
import {
  needsSuccession,
  getAdultSuccessionCandidates,
  getMinorSuccessionCandidates,
  chooseSuccessor,
} from '../selectors/successionSelectors'
import { setHouseHead } from '../mutations/houseMutations'
import { maybeSplitHouseAfterSuccession } from './houseSplitSystem'
import { extinctHouseAfterFailedSuccession } from './houseExtinctionSystem'
import type { HouseId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { SuccessionCandidate } from '../selectors/successionSelectors'
import { createLogger } from '../debug/logger'

export function runSuccessionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    if (!needsSuccession(currentCtx.state, house)) continue

    currentCtx = resolveHouseSuccession(currentCtx, houseId as HouseId)
  }

  return currentCtx
}

function resolveHouseSuccession(ctx: TickContext, houseId: HouseId): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  const log = createLogger(ctx.config.debug)
  const oldHeadId = house.headId

  const adultCandidates = getAdultSuccessionCandidates(ctx.state, house, ctx.config)

  if (adultCandidates.length === 0) {
    const minorCandidates = getMinorSuccessionCandidates(ctx.state, house, ctx.config)

    if (minorCandidates.length > 0) {
      const oldestMinor = minorCandidates[0]
      if (!oldestMinor) return extinctHouseAfterFailedSuccession(ctx, houseId)

      const newState = setHouseHead(ctx.state, houseId, oldestMinor.id)
      const { id: eventId, ctx: eventCtx } = makeEventId({ ...ctx, state: newState })
      const event: SimEvent = {
        id: eventId,
        year: newState.currentYear,
        month: newState.currentMonth,
        type: 'HOUSE_HEAD_CHANGED',
        importance: 'normal',
        actorIds: [oldestMinor.id],
        houseIds: [houseId],
        countryIds: [house.countryId],
        provinceIds: [],
        summary: oldestMinor.name + ' has become the new head of ' + house.name + '.',
        reasons: [],
        effects: [],
      }

      log.log('SUCCESSION', {
        year: newState.currentYear,
        month: newState.currentMonth,
        house: houseId,
        old_head: oldHeadId ?? '',
        new_head: oldestMinor.id,
        type: 'minor',
      })

      return { ...eventCtx, state: newState, events: [...eventCtx.events, event] }
    }

    return extinctHouseAfterFailedSuccession(ctx, houseId)
  }

  const successor = chooseSuccessor(adultCandidates)

  const newStateAfterHead = setHouseHead(ctx.state, houseId, successor.person.id)
  const { id: eventId, ctx: eventCtx } = makeEventId({ ...ctx, state: newStateAfterHead })
  const event: SimEvent = {
    id: eventId,
    year: newStateAfterHead.currentYear,
    month: newStateAfterHead.currentMonth,
    type: 'HOUSE_HEAD_CHANGED',
    importance: 'normal',
    actorIds: [successor.person.id],
    houseIds: [houseId],
    countryIds: [house.countryId],
    provinceIds: [],
    summary: successor.person.name + ' has become the new head of ' + house.name + '.',
    reasons: [],
    effects: [],
  }

  log.log('SUCCESSION', {
    year: newStateAfterHead.currentYear,
    month: newStateAfterHead.currentMonth,
    house: houseId,
    old_head: oldHeadId ?? '',
    new_head: successor.person.id,
    type: 'adult',
  })

  let resultCtx: TickContext = {
    ...eventCtx,
    state: newStateAfterHead,
    events: [...eventCtx.events, event],
  }

  if (adultCandidates.length >= 2) {
    const secondCandidate = adultCandidates[1]
    if (
      secondCandidate &&
      successor.score - secondCandidate.score <= ctx.config.successionCrisisScoreGap
    ) {
      const { id: crisisId, ctx: crisisCtx } = makeEventId(resultCtx)
      const crisisEvent: SimEvent = {
        id: crisisId,
        year: resultCtx.state.currentYear,
        month: resultCtx.state.currentMonth,
        type: 'SUCCESSION_CRISIS',
        importance: 'major',
        actorIds: [successor.person.id],
        houseIds: [houseId],
        countryIds: [house.countryId],
        provinceIds: [],
        summary: 'A succession crisis has erupted in ' + house.name + '!',
        reasons: [],
        effects: [],
      }
      log.log('SUCCESSION_CRISIS', {
        year: resultCtx.state.currentYear,
        month: resultCtx.state.currentMonth,
        house: houseId,
        new_head: successor.person.id,
        score: Math.round(successor.score),
        runner_up_score: Math.round(secondCandidate.score),
      })
      resultCtx = {
        ...crisisCtx,
        state: resultCtx.state,
        events: [...crisisCtx.events, crisisEvent],
      }
    }
  }

  const splitCandidates: SuccessionCandidate[] = adultCandidates.filter(
    (c) => c.person.id !== successor.person.id,
  )

  return maybeSplitHouseAfterSuccession(resultCtx, {
    houseId,
    successorId: successor.person.id,
    splitCandidates,
  })
}

export function applyMinorHeadPenalties(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active || !house.headId) continue

    const headPerson = currentCtx.state.persons[house.headId]
    if (!headPerson || headPerson.age >= currentCtx.config.adultAge) continue

    const newCohesion = Math.max(
      0,
      house.cohesion - currentCtx.config.minorHeadCohesionPenaltyPerMonth,
    )
    const newLoyalty = Math.max(
      0,
      house.loyaltyToCountry - currentCtx.config.minorHeadLoyaltyPenaltyPerMonth,
    )

    const newHouses = { ...currentCtx.state.houses }
    newHouses[houseId as HouseId] = {
      ...house,
      cohesion: newCohesion,
      loyaltyToCountry: newLoyalty,
    }

    currentCtx = { ...currentCtx, state: { ...currentCtx.state, houses: newHouses } }
  }

  return currentCtx
}
