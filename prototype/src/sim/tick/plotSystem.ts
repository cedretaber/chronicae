import type { TickContext } from './context'
import { makeEventId } from './context'
import { calcAmbitionScores } from './ambitionSystem'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import { adjustPersonLegacyPrestige, adjustHouseLegacyPrestige } from '../helpers/attitudeHelpers'
import { getHouseCohesion, getPolityStability } from '../selectors/statusSelectors'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getAvailableOfficeRoles } from '../selectors/officeSelectors'
import { createOfficeAssignment, revokeOfficesByOrganization } from '../mutations/officeMutations'
import { addPlot as addPlotMutation } from '../mutations/plotMutations'
import { adjustHouseMembersAttitude } from '../mutations/attitudeMutations'
import type { OrganizationRef, OfficeRole } from '../types/office'
import type { PlotId, HouseId, PersonId, PolityId } from '../types/ids'
import type { Plot, PlotType } from '../types/plot'
import type { SimEvent, EventType } from '../types/event'
import type { Person } from '../types/person'
import { getRoleScore } from '../selectors/abilitySelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'

function emitEvent(
  ctx: TickContext,
  type: EventType,
  importance: 'minor' | 'normal' | 'major' | 'critical',
  actorIds: PersonId[],
  houseIds: HouseId[],
  polityIds: PolityId[],
  summary: string,
): TickContext {
  const { id: eventId, ctx: eventCtx } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    weekOfYear: eventCtx.state.currentWeekOfYear,
    type,
    importance,
    actorIds,
    houseIds,
    polityIds,
    provinceIds: [],
    summary,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, events: [...eventCtx.events, event] }
}

type ResolveResult = {
  ctx: TickContext
  succeeded: boolean
}

function resolvePlot(currentCtx: TickContext, plot: Plot): ResolveResult {
  const leader = currentCtx.state.persons[plot.leaderId]
  // 死亡した leader の plot は無効化 (dead person を Office に任命する事故を防ぐ)
  if (!leader || !leader.alive) {
    const updatedPlots = { ...currentCtx.state.activePlots }
    delete updatedPlots[plot.id]
    return {
      ctx: { ...currentCtx, state: { ...currentCtx.state, activePlots: updatedPlots } },
      succeeded: false,
    }
  }

  let targetDefense: number
  switch (plot.type) {
    case 'replace_house_leader': {
      const th = currentCtx.state.houses[plot.targetHouseId as HouseId]
      targetDefense = th ? getHouseCohesion(currentCtx.state, th.id) : 0
      break
    }
    case 'seize_office': {
      const tp = currentCtx.state.polities[plot.targetPolityId as PolityId]
      targetDefense = tp?.adminPower ?? 0
      break
    }
    case 'prepare_rebellion': {
      const tp = currentCtx.state.polities[plot.targetPolityId as PolityId]
      const adminPower = tp?.adminPower ?? 0
      const stability = tp ? getPolityStability(currentCtx.state, currentCtx.config, tp.id) : 0
      targetDefense = adminPower * 0.5 + stability * 0.5
      break
    }
  }

  const plotSuccessChance = clamp(
    currentCtx.config.basePlotSuccess +
      ((getRoleScore(currentCtx.state, leader.id, 'governance') / 10 +
        getRoleScore(currentCtx.state, leader.id, 'warCommand') / 10) /
        2) *
        0.1 +
      (plot.power / 100) * 0.15 +
      (plot.secrecy / 100) * 0.1 -
      (targetDefense / 100) * 0.2 -
      (plot.risk / 100) * 0.2,
    0.05,
    0.95,
  )

  const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
  const rolledCtx = { ...currentCtx, rng: nextRng }
  const succeeded = roll < plotSuccessChance

  if (succeeded) {
    const resultCtx = applyPlotSuccess(rolledCtx, plot, leader)
    return { ctx: resultCtx, succeeded: true }
  } else {
    const resultCtx = applyPlotFailure(rolledCtx, plot, leader)
    return { ctx: resultCtx, succeeded: false }
  }
}

function applyPlotSuccess(currentCtx: TickContext, plot: Plot, leader: Person): TickContext {
  let state = currentCtx.state

  switch (plot.type) {
    case 'replace_house_leader': {
      const targetHouse = currentCtx.state.houses[plot.targetHouseId as HouseId]
      if (targetHouse) {
        const currentHeadId = getHouseLeader(currentCtx.state, targetHouse.id)
        // Find a new head from within the target house's existing members
        const newHead = targetHouse.memberIds
          .map((id) => state.persons[id])
          .filter(
            (p): p is NonNullable<typeof p> =>
              p !== undefined &&
              p.alive &&
              p.age >= currentCtx.config.adultAge &&
              (p.id as string) !== (currentHeadId ?? ''),
          )
          .sort((a, b) => b.legacyPrestige - a.legacyPrestige)[0]

        if (newHead) {
          // Apply office mutation: revoke all offices for the organization, then assign to new leader
          const targetOrgRef: OrganizationRef = { kind: 'house', id: targetHouse.id }
          let newState = revokeOfficesByOrganization(state, targetOrgRef, 'leader')
          newState = createOfficeAssignment(newState, targetOrgRef, 'leader', newHead.id)
          state = newState

          // Adjust target house member attitudes
          if (currentHeadId) {
            const r = adjustHouseMembersAttitude(
              state,
              targetHouse.id,
              { kind: 'person', id: currentHeadId },
              {
                respect: -10,
              },
            )
            if (r.ok) state = r.value
          }
          const r2 = adjustHouseMembersAttitude(
            state,
            targetHouse.id,
            { kind: 'person', id: newHead.id },
            { respect: 8 },
          )
          if (r2.ok) state = r2.value
        }

        // Leader legacyPrestige +5
        state = adjustPersonLegacyPrestige(state, plot.leaderId, 5)
      }

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.name}'s ${plot.type} plot succeeded.`,
      )
    }

    case 'seize_office': {
      const targetPolity = currentCtx.state.polities[plot.targetPolityId as PolityId]
      if (targetPolity) {
        const targetRole = plot.targetRole
        if (targetRole) {
          const targetPolityId = plot.targetPolityId
          if (!targetPolityId) return currentCtx
          const polityOrgRef: OrganizationRef = { kind: 'polity', id: targetPolityId }
          state = createOfficeAssignment(state, polityOrgRef, targetRole, plot.leaderId)
        }
      }

      state = adjustPersonLegacyPrestige(state, plot.leaderId, 5)
      state = adjustHouseLegacyPrestige(state, leader.houseId, 2)

      const targetPolityId = plot.targetPolityId
      const polityIds: PolityId[] = targetPolityId
        ? [targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.name}'s ${plot.type} plot succeeded.`,
      )
    }

    case 'prepare_rebellion': {
      const leaderPrimaryPolityId = getHousePrimaryPolityId(state, leader.houseId)
      const rr = adjustHouseMembersAttitude(
        state,
        leader.houseId,
        { kind: 'polity', id: leaderPrimaryPolityId as PolityId },
        {
          affection: -8,
          respect: -5,
        },
      )
      if (rr.ok) state = rr.value

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [leaderPrimaryPolityId as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.name}'s ${plot.type} plot succeeded.`,
      )
    }
  }
}

function applyPlotFailure(currentCtx: TickContext, plot: Plot, leader: Person): TickContext {
  let state = currentCtx.state

  switch (plot.type) {
    case 'replace_house_leader': {
      state = adjustPersonLegacyPrestige(state, plot.leaderId, -3)

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.name}'s ${plot.type} plot failed.`,
      )
    }

    case 'seize_office': {
      state = adjustPersonLegacyPrestige(state, plot.leaderId, -3)

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.name}'s ${plot.type} plot failed.`,
      )
    }

    case 'prepare_rebellion': {
      state = adjustPersonLegacyPrestige(state, plot.leaderId, -3)

      const polityIds: PolityId[] = plot.targetPolityId
        ? [plot.targetPolityId]
        : [getHousePrimaryPolityId(state, leader.houseId) as PolityId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        polityIds,
        `${leader.name}'s ${plot.type} plot failed.`,
      )
    }
  }
}

function startNewPlot(currentCtx: TickContext, houseId: HouseId): TickContext {
  const house = currentCtx.state.houses[houseId]
  if (!house || !house.active) return currentCtx

  const leaderId = getHouseLeader(currentCtx.state, houseId)
  if (!leaderId) return currentCtx

  const head = currentCtx.state.persons[leaderId]
  if (!head || !head.alive) return currentCtx

  // Check if house already has an active plot
  const hasActivePlot = Object.values(currentCtx.state.activePlots).some(
    (p) => p.leaderId === leaderId && p.status === 'active',
  )
  if (hasActivePlot) return currentCtx

  // Compute rebellionTendency
  const { rebellionTendency } = calcAmbitionScores(currentCtx.state, houseId)

  // Determine plot type using RNG
  const { value: typeRoll, rng: rng1 } = randomFloat(currentCtx.rng)
  const ctx1 = { ...currentCtx, rng: rng1 }

  const rebelBias = Math.max(0, (rebellionTendency - currentCtx.config.rebellionThreshold) / 100)

  let plotType: PlotType
  if (typeRoll < 0.25 + rebelBias) {
    plotType = 'prepare_rebellion'
  } else if (typeRoll < 0.6) {
    plotType = 'seize_office'
  } else {
    plotType = 'replace_house_leader'
  }

  // Roll stats using 3 separate randomFloat calls
  const { value: powerRoll, rng: rng2 } = randomFloat(ctx1.rng)
  const ctx2 = { ...ctx1, rng: rng2 }

  const { value: secrecyRoll, rng: rng3 } = randomFloat(ctx2.rng)
  const ctx3 = { ...ctx2, rng: rng3 }

  const { value: riskRoll, rng: rng4 } = randomFloat(ctx3.rng)
  const ctx4 = { ...ctx3, rng: rng4 }

  const power = Math.floor(powerRoll * 60) + 20
  const secrecy = Math.floor(secrecyRoll * 60) + 20
  const risk = Math.floor(riskRoll * 60) + 20
  const durationWeeks = plotType === 'prepare_rebellion' ? 24 : 12

  // Generate PlotId
  const { id: rawId, ctx: eventCtx } = makeEventId(ctx4)
  const plotId = rawId.replace(/^e-/, 'p-') as PlotId

  // Determine target fields based on plotType
  let targetHouseId: HouseId | undefined
  let targetPolityId: PolityId | undefined
  let targetRole: OfficeRole | undefined

  switch (plotType) {
    case 'replace_house_leader': {
      const candidates: HouseId[] = []
      for (const cid of Object.keys(currentCtx.state.houses).sort()) {
        const candidateHouse = currentCtx.state.houses[cid as HouseId]
        if (!candidateHouse) continue
        if (cid === houseId) continue
        if (!candidateHouse.active) continue
        if (candidateHouse.kind === 'system') continue
        const candidatePrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, cid as HouseId)
        const housePrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, house.id)
        if (
          !candidatePrimaryPolityId ||
          !housePrimaryPolityId ||
          candidatePrimaryPolityId !== housePrimaryPolityId
        )
          continue
        const candidateHeadId = getHouseLeader(currentCtx.state, cid as HouseId)
        if (!candidateHeadId) continue
        const candidateHead = currentCtx.state.persons[candidateHeadId]
        if (!candidateHead || !candidateHead.alive) continue
        candidates.push(cid as HouseId)
      }
      candidates.sort()
      const target = candidates[0]
      if (target) {
        targetHouseId = target
      }
      break
    }

    case 'seize_office': {
      const housePrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, house.id)
      if (housePrimaryPolityId) {
        const polityOrgRef: OrganizationRef = { kind: 'polity', id: housePrimaryPolityId }
        const availableRoles = getAvailableOfficeRoles(currentCtx.state, polityOrgRef)
        // Pick a non-leader role if available, otherwise pick the first available
        const nonLeaderRole = availableRoles.find((r) => r !== 'leader')
        if (nonLeaderRole) {
          targetRole = nonLeaderRole
        } else if (availableRoles.length > 0) {
          targetRole = availableRoles[0]
        }
      }
      targetPolityId = housePrimaryPolityId
      break
    }

    case 'prepare_rebellion': {
      const housePrimaryPolityId = getHousePrimaryPolityId(currentCtx.state, house.id)
      targetPolityId = housePrimaryPolityId
      break
    }
  }

  // Build Plot object - only include defined optional fields
  const newPlot: Plot = {
    id: plotId,
    type: plotType,
    status: 'active',
    startedWeek: eventCtx.state.absoluteWeek,
    durationWeeks,
    leaderId: leaderId,
    participantIds: [leaderId],
    power,
    secrecy,
    risk,
    ...(targetHouseId !== undefined ? { targetHouseId } : {}),
    ...(targetPolityId !== undefined ? { targetPolityId } : {}),
    ...(targetRole !== undefined ? { targetRole } : {}),
  }

  const addResult = addPlotMutation(eventCtx.state, newPlot)
  const newState = addResult.ok ? addResult.value : eventCtx.state

  // Emit PLOT_STARTED event
  const housePrimaryPolityId = getHousePrimaryPolityId(eventCtx.state, house.id)
  const polityIds: PolityId[] = targetPolityId
    ? [targetPolityId]
    : housePrimaryPolityId
      ? [housePrimaryPolityId]
      : []

  return emitEvent(
    { ...eventCtx, state: newState, events: [...eventCtx.events] },
    'PLOT_STARTED',
    'normal',
    [leaderId],
    [houseId],
    polityIds,
    `${head.name} began a ${plotType} plot.`,
  )
}

export function runPlotSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // === PHASE A: Resolve existing plots ===
  const activePlotIds = Object.keys(ctx.state.activePlots).sort()

  for (const plotId of activePlotIds) {
    const plot = currentCtx.state.activePlots[plotId as PlotId]
    if (!plot || plot.status !== 'active') {
      continue
    }

    // Check if plot has expired using absoluteWeek comparison
    if (ctx.state.absoluteWeek >= plot.startedWeek + plot.durationWeeks) {
      // Resolve the plot
      const result = resolvePlot(currentCtx, plot)
      const status: 'succeeded' | 'failed' = result.succeeded ? 'succeeded' : 'failed'

      const updatedPlots = { ...result.ctx.state.activePlots }
      updatedPlots[plotId as PlotId] = { ...plot, status }
      currentCtx = {
        ...result.ctx,
        state: { ...result.ctx.state, activePlots: updatedPlots },
      }
      continue
    }

    continue
  }

  // === PHASE B: Start new plots ===
  const houseIds = Object.keys(ctx.state.houses).sort()

  for (const houseId of houseIds) {
    const scores = calcAmbitionScores(currentCtx.state, houseId as HouseId)
    if (scores.plotTendency < currentCtx.config.plotThreshold) continue

    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue

    const leaderId = getHouseLeader(currentCtx.state, houseId as HouseId)
    if (!leaderId) continue

    const head = currentCtx.state.persons[leaderId]
    if (!head || !head.alive) continue

    const hasActivePlot = Object.values(currentCtx.state.activePlots).some(
      (p) => p.leaderId === leaderId && p.status === 'active',
    )
    if (hasActivePlot) continue

    currentCtx = startNewPlot(currentCtx, houseId as HouseId)
  }

  return currentCtx
}
