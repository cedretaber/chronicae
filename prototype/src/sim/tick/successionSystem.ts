import type { TickContext } from './context'
import { makeEventId } from './context'
import {
  needsSuccession,
  getAdultSuccessionCandidates,
  getMinorSuccessionCandidates,
  chooseSuccessor,
} from '../selectors/successionSelectors'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { getHouseLeader, getCountryRuler } from '../selectors/officeSelectors'
import { maybeSplitHouseAfterSuccession } from './houseSplitSystem'
import { extinctHouseAfterFailedSuccession } from './houseExtinctionSystem'
import type { HouseId, CountryId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { SuccessionCandidate } from '../selectors/successionSelectors'
import { createLogger } from '../debug/logger'
import { countryAttitudeKey, houseAttitudeKey } from '../helpers/attitudeHelpers'
import { adjustHouseMembersAttitude } from '../mutations/attitudeMutations'

export function runSuccessionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    if (!needsSuccession(currentCtx.state, house)) continue

    currentCtx = resolveHouseSuccession(currentCtx, houseId as HouseId)
  }

  // Country ruler succession: if an active country has no ruler, appoint one
  for (const countryId of Object.keys(currentCtx.state.countries).sort()) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country || !country.active) continue

    const currentRuler = getCountryRuler(currentCtx.state, countryId as CountryId)
    if (currentRuler) continue // Already has a ruler

    // Find the active house (matching countryId) with the most provinces
    let bestHouseId: HouseId | undefined
    let bestProvinceCount = -1

    for (const houseId of country.houseIds) {
      const house = currentCtx.state.houses[houseId]
      if (!house || !house.active || house.countryId !== (countryId as CountryId)) continue
      const leader = getHouseLeader(currentCtx.state, houseId)
      if (!leader) continue
      if (house.provinceIds.length > bestProvinceCount) {
        bestProvinceCount = house.provinceIds.length
        bestHouseId = houseId
      }
    }

    if (!bestHouseId) continue

    const newRulerPersonId = getHouseLeader(currentCtx.state, bestHouseId)
    if (!newRulerPersonId) continue

    const newState = createOfficeAssignment(
      currentCtx.state,
      { kind: 'country', id: countryId as CountryId },
      'leader',
      newRulerPersonId,
    )

    const newRuler = newState.persons[newRulerPersonId]
    const { id: eventId, ctx: eventCtx } = makeEventId({ ...currentCtx, state: newState })
    const event: SimEvent = {
      id: eventId,
      year: newState.currentYear,
      month: newState.currentMonth,
      type: 'RULER_CHANGED',
      importance: 'critical',
      actorIds: [newRulerPersonId],
      houseIds: [bestHouseId],
      countryIds: [countryId as CountryId],
      provinceIds: [],
      summary: `${newRuler?.name ?? 'Unknown'} has become the new ruler of ${country.name}.`,
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

function resolveHouseSuccession(ctx: TickContext, houseId: HouseId): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  const log = createLogger(ctx.config.debug)
  const oldLeaderId = getHouseLeader(ctx.state, houseId)

  const adultCandidates = getAdultSuccessionCandidates(ctx.state, house, ctx.config)

  if (adultCandidates.length === 0) {
    const minorCandidates = getMinorSuccessionCandidates(ctx.state, house, ctx.config)

    if (minorCandidates.length > 0) {
      const oldestMinor = minorCandidates[0]
      if (!oldestMinor) return extinctHouseAfterFailedSuccession(ctx, houseId)

      let newState = revokeOfficesByOrganization(
        ctx.state,
        { kind: 'house', id: houseId },
        'leader',
      )
      newState = createOfficeAssignment(
        newState,
        { kind: 'house', id: houseId },
        'leader',
        oldestMinor.id,
      )
      const { id: eventId, ctx: eventCtx } = makeEventId({ ...ctx, state: newState })
      const event: SimEvent = {
        id: eventId,
        year: newState.currentYear,
        month: newState.currentMonth,
        type: 'HOUSE_LEADER_CHANGED',
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
        old_head: oldLeaderId ?? '',
        new_head: oldestMinor.id,
        type: 'minor',
      })

      return { ...eventCtx, state: newState, events: [...eventCtx.events, event] }
    }

    return extinctHouseAfterFailedSuccession(ctx, houseId)
  }

  const successor = chooseSuccessor(adultCandidates)

  let newStateAfterHead = revokeOfficesByOrganization(
    ctx.state,
    { kind: 'house', id: houseId },
    'leader',
  )
  newStateAfterHead = createOfficeAssignment(
    newStateAfterHead,
    { kind: 'house', id: houseId },
    'leader',
    successor.person.id,
  )
  const { id: eventId, ctx: eventCtx } = makeEventId({ ...ctx, state: newStateAfterHead })
  const event: SimEvent = {
    id: eventId,
    year: newStateAfterHead.currentYear,
    month: newStateAfterHead.currentMonth,
    type: 'HOUSE_LEADER_CHANGED',
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
    old_head: oldLeaderId ?? '',
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
    if (!house || !house.active) continue

    const headId = getHouseLeader(currentCtx.state, houseId as HouseId)
    if (!headId) continue
    const headPerson = currentCtx.state.persons[headId]
    if (!headPerson || headPerson.age >= currentCtx.config.adultAge) continue

    const countryKey = countryAttitudeKey(house.countryId)
    const houseKey = houseAttitudeKey(houseId as HouseId)
    let state = currentCtx.state
    const r1 = adjustHouseMembersAttitude(state, houseId as HouseId, houseKey, {
      respect: -currentCtx.config.minorHeadCohesionPenaltyPerMonth,
    })
    if (r1.ok) state = r1.value
    const r2 = adjustHouseMembersAttitude(state, houseId as HouseId, countryKey, {
      affection: -currentCtx.config.minorHeadLoyaltyPenaltyPerMonth,
    })
    if (r2.ok) state = r2.value

    currentCtx = { ...currentCtx, state }
  }

  return currentCtx
}
