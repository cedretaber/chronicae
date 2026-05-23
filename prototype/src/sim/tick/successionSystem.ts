import type { TickContext } from './context'
import { createSimEvent } from './context'
import { nameParam, entityRef } from '../types/event'
import {
  needsSuccession,
  getAdultSuccessionCandidates,
  getMinorSuccessionCandidates,
  chooseSuccessor,
} from '../selectors/successionSelectors'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { installHoldingPlaceholderBailiff } from '../mutations/provinceOfficeMutations'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import { maybeSplitHouseAfterSuccession } from './houseSplitSystem'
import { extinctHouseAfterFailedSuccession } from './houseExtinctionSystem'
import type { HouseId, PersonId, PolityId } from '../types/ids'
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
    if (house.kind === 'system') continue

    if (!needsSuccession(currentCtx.state, house)) continue

    currentCtx = resolveHouseSuccession(currentCtx, houseId as HouseId)
  }

  // Polity ruler succession: if an active polity has no ruler, appoint one
  for (const polityId of Object.keys(currentCtx.state.polities).sort()) {
    const polity = currentCtx.state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue
    // v0.18-pre: commonwealth Polity は leader 死後も新 leader を補充しない (永続 commonwealth サポート)
    if (polity.kind === 'commonwealth') continue

    const currentRuler = getPolityLeader(currentCtx.state, polityId as PolityId)
    if (currentRuler) continue // Already has a ruler

    // Find the active house (matching polity) with the most provinces
    let bestHouseId: HouseId | undefined
    let bestProvinceCount = -1

    for (const houseId of getPolityHouseIds(currentCtx.state, polityId as PolityId)) {
      const house = currentCtx.state.houses[houseId]
      if (!house || !house.active) continue
      // ownerHouse は常に候補。それ以外は primaryPolityId が一致する場合のみ候補
      if (
        houseId !== polity.ownerHouseId &&
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
    const { event, ctx: eventCtx } = createSimEvent(
      { ...currentCtx, state: newState },
      {
        type: 'POLITY_LEADER_CHANGED',
        importance: 'critical',
        messageKey: 'polity.leader_changed',
        messageParams: {
          person: newRuler ? nameParam('person', newRuler.nameKey) : 'Unknown',
          polity: nameParam('polity', polity.nameKey),
        },
        entityRefs: [
          entityRef('person', newRulerPersonId, 'ruler', newRuler?.nameKey),
          entityRef('polity', polityId, 'polity', polity.nameKey),
          entityRef('house', bestHouseId, 'house'),
        ],
      },
    )

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
      const { event, ctx: eventCtx } = createSimEvent(
        { ...ctx, state: newState },
        {
          type: 'HOUSE_LEADER_CHANGED',
          importance: 'normal',
          messageKey: 'house.leader_changed',
          messageParams: {
            person: nameParam('person', oldestMinor.nameKey),
            house: nameParam('house', house.nameKey),
          },
          entityRefs: [
            entityRef('person', oldestMinor.id, 'leader', oldestMinor.nameKey),
            entityRef('house', houseId, 'house', house.nameKey),
          ],
        },
      )

      log.log('SUCCESSION', {
        year: newState.currentYear,
        week: newState.currentWeekOfYear,
        house: houseId,
        old_head: oldLeaderId ?? '',
        new_head: oldestMinor.id,
        type: 'minor',
      })

      let minorCtx: TickContext = {
        ...eventCtx,
        state: newState,
        events: [...eventCtx.events, event],
      }
      minorCtx = vacatePersonBailiffPositions(minorCtx, oldestMinor.id)
      return minorCtx
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
  const { event, ctx: eventCtx } = createSimEvent(
    { ...ctx, state: newStateAfterHead },
    {
      type: 'HOUSE_LEADER_CHANGED',
      importance: 'normal',
      messageKey: 'house.leader_changed',
      messageParams: {
        person: nameParam('person', successor.person.nameKey),
        house: nameParam('house', house.nameKey),
      },
      entityRefs: [
        entityRef('person', successor.person.id, 'leader', successor.person.nameKey),
        entityRef('house', houseId, 'house', house.nameKey),
      ],
    },
  )

  log.log('SUCCESSION', {
    year: newStateAfterHead.currentYear,
    week: newStateAfterHead.currentWeekOfYear,
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

  resultCtx = vacatePersonBailiffPositions(resultCtx, successor.person.id)

  if (adultCandidates.length >= 2) {
    const secondCandidate = adultCandidates[1]
    if (
      secondCandidate &&
      successor.score - secondCandidate.score <= ctx.config.successionCrisisScoreGap
    ) {
      const { event: crisisEvent, ctx: crisisCtx } = createSimEvent(resultCtx, {
        type: 'SUCCESSION_CRISIS',
        importance: 'major',
        messageKey: 'succession.crisis',
        messageParams: {
          house: nameParam('house', house.nameKey),
        },
        entityRefs: [
          entityRef('person', successor.person.id, 'claimant', successor.person.nameKey),
          entityRef('house', houseId, 'house', house.nameKey),
        ],
      })
      log.log('SUCCESSION_CRISIS', {
        year: resultCtx.state.currentYear,
        week: resultCtx.state.currentWeekOfYear,
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

function vacatePersonBailiffPositions(ctx: TickContext, personId: PersonId): TickContext {
  const ids = ctx.state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  let state = ctx.state
  for (const assignmentId of ids) {
    const assignment = state.holdingOfficeAssignments[assignmentId]
    if (!assignment || !assignment.active) continue
    state = installHoldingPlaceholderBailiff(state, {
      holdingId: assignment.holdingId,
      appointingPolityId: assignment.appointingPolityId,
      week: state.absoluteWeek,
    })
  }
  if (state === ctx.state) return ctx
  return { ...ctx, state }
}
