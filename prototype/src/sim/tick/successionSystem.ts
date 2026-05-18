import type { TickContext } from './context'
import { makeEventId } from './context'
import {
  needsSuccession,
  getAdultSuccessionCandidates,
  getMinorSuccessionCandidates,
  chooseSuccessor,
} from '../selectors/successionSelectors'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import { maybeSplitHouseAfterSuccession } from './houseSplitSystem'
import { extinctHouseAfterFailedSuccession } from './houseExtinctionSystem'
import type { HouseId, PolityId } from '../types/ids'
import type { SimEvent } from '../types/event'
import type { SuccessionCandidate } from '../selectors/successionSelectors'
import { createLogger } from '../debug/logger'
import { adjustHouseMembersAttitude } from '../mutations/attitudeMutations'
import { getHousePrimaryPolityId, getPolityHouseIds } from '../selectors/polityRelations'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'

export function runSuccessionSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  for (const houseId of Object.keys(currentCtx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    if (!needsSuccession(currentCtx.state, house)) continue

    currentCtx = resolveHouseSuccession(currentCtx, houseId as HouseId)
  }

  // Polity ruler succession: if an active polity has no ruler, appoint one
  for (const polityId of Object.keys(currentCtx.state.polities).sort()) {
    const polity = currentCtx.state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue

    const currentRuler = getPolityLeader(currentCtx.state, polityId as PolityId)
    if (currentRuler) continue // Already has a ruler

    // Find the active house (matching polity) with the most provinces
    let bestHouseId: HouseId | undefined
    let bestProvinceCount = -1

    for (const houseId of getPolityHouseIds(currentCtx.state, polityId as PolityId)) {
      const house = currentCtx.state.houses[houseId]
      if (
        !house ||
        !house.active ||
        getHousePrimaryPolityId(currentCtx.state, houseId) !== (polityId as PolityId)
      )
        continue
      const leader = getHouseLeader(currentCtx.state, houseId)
      if (!leader) continue
      const controlledCount = getHouseControlledProvinceIds(currentCtx.state, houseId).length
      if (controlledCount > bestProvinceCount) {
        bestProvinceCount = controlledCount
        bestHouseId = houseId
      }
    }

    if (!bestHouseId) continue

    const newRulerPersonId = getHouseLeader(currentCtx.state, bestHouseId)
    if (!newRulerPersonId) continue

    const newState = createOfficeAssignment(
      currentCtx.state,
      { kind: 'polity', id: polityId as PolityId },
      'leader',
      newRulerPersonId,
    )

    const newRuler = newState.persons[newRulerPersonId]
    const { id: eventId, ctx: eventCtx } = makeEventId({ ...currentCtx, state: newState })
    const event: SimEvent = {
      id: eventId,
      year: newState.currentYear,
      month: newState.currentMonth,
      type: 'POLITY_LEADER_CHANGED',
      importance: 'critical',
      actorIds: [newRulerPersonId],
      houseIds: [bestHouseId],
      polityIds: [polityId as PolityId],
      provinceIds: [],
      summary: `${newRuler?.name ?? 'Unknown'} has become the new ruler of ${polity.name}.`,
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
        polityIds: [],
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
    polityIds: [],
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
        polityIds: [],
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

    let state = currentCtx.state
    const r1 = adjustHouseMembersAttitude(
      state,
      houseId as HouseId,
      { kind: 'house', id: houseId as HouseId },
      {
        respect: -currentCtx.config.minorHeadCohesionPenaltyPerMonth,
      },
    )
    if (r1.ok) state = r1.value

    const housePrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, house.id)
    const r2 = adjustHouseMembersAttitude(
      state,
      houseId as HouseId,
      { kind: 'polity', id: housePrimaryPolityId as PolityId },
      {
        affection: -currentCtx.config.minorHeadLoyaltyPenaltyPerMonth,
      },
    )
    if (r2.ok) state = r2.value

    currentCtx = { ...currentCtx, state }
  }

  return currentCtx
}
