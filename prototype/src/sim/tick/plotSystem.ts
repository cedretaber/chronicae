import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp, clamp100 } from '../utils/math'
import { calcAmbitionScores } from './ambitionSystem'
import { assignRole } from '../mutations/assignRole'
import type { PlotId, HouseId, PersonId, CountryId } from '../types/ids'
import type { RoleType } from '../types/role'
import type { Plot, PlotType } from '../types/plot'
import type { SimEvent, EventType } from '../types/event'
import type { Person } from '../types/person'

function emitEvent(
  ctx: TickContext,
  type: EventType,
  importance: 'minor' | 'normal' | 'major' | 'critical',
  actorIds: PersonId[],
  houseIds: HouseId[],
  countryIds: CountryId[],
  summary: string,
): TickContext {
  const { id: eventId, ctx: eventCtx } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type,
    importance,
    actorIds,
    houseIds,
    countryIds,
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
  if (!leader) {
    const updatedPlots = { ...currentCtx.state.activePlots }
    delete updatedPlots[plot.id]
    return {
      ctx: { ...currentCtx, state: { ...currentCtx.state, activePlots: updatedPlots } },
      succeeded: false,
    }
  }

  let targetDefense: number
  switch (plot.type) {
    case 'replace_house_head': {
      const th = currentCtx.state.houses[plot.targetHouseId as HouseId]
      targetDefense = th?.cohesion ?? 0
      break
    }
    case 'seize_role': {
      const tc = currentCtx.state.countries[plot.targetCountryId as CountryId]
      targetDefense = tc?.adminPower ?? 0
      break
    }
    case 'prepare_rebellion': {
      const tc = currentCtx.state.countries[plot.targetCountryId as CountryId]
      const adminPower = tc?.adminPower ?? 0
      const stability = tc?.stability ?? 0
      targetDefense = adminPower * 0.5 + stability * 0.5
      break
    }
  }

  const plotSuccessChance = clamp(
    currentCtx.config.basePlotSuccess +
      ((leader.stats.admin + leader.stats.martial) / 20) * 0.1 +
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
    case 'replace_house_head': {
      const targetHouse = currentCtx.state.houses[plot.targetHouseId as HouseId]
      if (targetHouse) {
        const currentHeadId = targetHouse.headId as string
        // Find a new head from within the target house's existing members
        const newHead = targetHouse.memberIds
          .map((id) => state.persons[id])
          .filter(
            (p): p is NonNullable<typeof p> =>
              p !== undefined &&
              p.alive &&
              p.age >= currentCtx.config.adultAge &&
              (p.id as string) !== currentHeadId,
          )
          .sort((a, b) => b.prestige - a.prestige)[0]

        if (newHead) {
          const oldHead = state.persons[targetHouse.headId]
          if (oldHead) {
            const newPersons = { ...state.persons }
            newPersons[oldHead.id] = { ...oldHead, prestige: clamp100(oldHead.prestige - 20) }
            state = { ...state, persons: newPersons }
          }

          const newHouses = { ...state.houses }
          newHouses[plot.targetHouseId as HouseId] = {
            ...targetHouse,
            headId: newHead.id,
            cohesion: clamp100(targetHouse.cohesion - 10),
          }
          state = { ...state, houses: newHouses }
        }
      }

      const updatedLeader = state.persons[plot.leaderId]
      if (updatedLeader) {
        const newPersons = { ...state.persons }
        newPersons[plot.leaderId] = {
          ...updatedLeader,
          prestige: clamp100(updatedLeader.prestige + 15),
        }
        state = { ...state, persons: newPersons }
      }

      const countryIds: CountryId[] = plot.targetCountryId
        ? [plot.targetCountryId]
        : [leader.countryId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        countryIds,
        `${leader.name}'s ${plot.type} plot succeeded.`,
      )
    }

    case 'seize_role': {
      const targetCountry = currentCtx.state.countries[plot.targetCountryId as CountryId]
      if (targetCountry) {
        const targetRole = plot.targetRole
        if (targetRole) {
          try {
            const assignedState = assignRole(
              state,
              plot.targetCountryId as CountryId,
              targetRole,
              plot.leaderId,
            )
            state = assignedState
          } catch {
            // On error, just mark succeeded without state changes
          }
        }
      }

      const updatedLeader = state.persons[plot.leaderId]
      if (updatedLeader) {
        const newPersons = { ...state.persons }
        newPersons[plot.leaderId] = {
          ...updatedLeader,
          prestige: clamp100(updatedLeader.prestige + 10),
        }
        state = { ...state, persons: newPersons }
      }

      const leaderHouse = state.houses[leader.houseId]
      if (leaderHouse) {
        const newHouses = { ...state.houses }
        newHouses[leader.houseId] = {
          ...leaderHouse,
          prestige: clamp100(leaderHouse.prestige + 5),
        }
        state = { ...state, houses: newHouses }
      }

      const countryIds: CountryId[] = plot.targetCountryId
        ? [plot.targetCountryId]
        : [leader.countryId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        countryIds,
        `${leader.name}'s ${plot.type} plot succeeded.`,
      )
    }

    case 'prepare_rebellion': {
      const leaderHouse = state.houses[leader.houseId]
      if (leaderHouse) {
        const newHouses = { ...state.houses }
        newHouses[leader.houseId] = {
          ...leaderHouse,
          loyaltyToCountry: clamp100(leaderHouse.loyaltyToCountry - 15),
        }
        state = { ...state, houses: newHouses }
      }

      const countryIds: CountryId[] = plot.targetCountryId
        ? [plot.targetCountryId]
        : [leader.countryId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_SUCCEEDED',
        'major',
        [plot.leaderId],
        [leader.houseId],
        countryIds,
        `${leader.name}'s ${plot.type} plot succeeded.`,
      )
    }
  }
}

function applyPlotFailure(currentCtx: TickContext, plot: Plot, leader: Person): TickContext {
  let state = currentCtx.state

  switch (plot.type) {
    case 'replace_house_head': {
      const updatedLeader = state.persons[plot.leaderId]
      if (updatedLeader) {
        const newPersons = { ...state.persons }
        newPersons[plot.leaderId] = {
          ...updatedLeader,
          prestige: clamp100(updatedLeader.prestige - 15),
        }
        state = { ...state, persons: newPersons }
      }

      const targetHouse = state.houses[plot.targetHouseId as HouseId]
      if (targetHouse) {
        const newHouses = { ...state.houses }
        newHouses[plot.targetHouseId as HouseId] = {
          ...targetHouse,
          cohesion: clamp100(targetHouse.cohesion - 5),
        }
        state = { ...state, houses: newHouses }
      }

      const countryIds: CountryId[] = plot.targetCountryId
        ? [plot.targetCountryId]
        : [leader.countryId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        countryIds,
        `${leader.name}'s ${plot.type} plot failed.`,
      )
    }

    case 'seize_role': {
      const updatedLeader = state.persons[plot.leaderId]
      if (updatedLeader) {
        const newPersons = { ...state.persons }
        newPersons[plot.leaderId] = {
          ...updatedLeader,
          prestige: clamp100(updatedLeader.prestige - 10),
        }
        state = { ...state, persons: newPersons }
      }

      const leaderHouse = state.houses[leader.houseId]
      if (leaderHouse) {
        const newHouses = { ...state.houses }
        newHouses[leader.houseId] = {
          ...leaderHouse,
          loyaltyToCountry: clamp100(leaderHouse.loyaltyToCountry - 5),
        }
        state = { ...state, houses: newHouses }
      }

      const countryIds: CountryId[] = plot.targetCountryId
        ? [plot.targetCountryId]
        : [leader.countryId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        countryIds,
        `${leader.name}'s ${plot.type} plot failed.`,
      )
    }

    case 'prepare_rebellion': {
      const updatedLeader = state.persons[plot.leaderId]
      if (updatedLeader) {
        const newPersons = { ...state.persons }
        newPersons[plot.leaderId] = {
          ...updatedLeader,
          prestige: clamp100(updatedLeader.prestige - 10),
        }
        state = { ...state, persons: newPersons }
      }

      const leaderHouse = state.houses[leader.houseId]
      if (leaderHouse) {
        const newHouses = { ...state.houses }
        newHouses[leader.houseId] = {
          ...leaderHouse,
          loyaltyToCountry: clamp100(leaderHouse.loyaltyToCountry - 10),
        }
        state = { ...state, houses: newHouses }
      }

      const targetCountry = state.countries[plot.targetCountryId as CountryId]
      if (targetCountry) {
        const newCountries = { ...state.countries }
        newCountries[plot.targetCountryId as CountryId] = {
          ...targetCountry,
          stability: clamp100(targetCountry.stability - 5),
        }
        state = { ...state, countries: newCountries }
      }

      const countryIds: CountryId[] = plot.targetCountryId
        ? [plot.targetCountryId]
        : [leader.countryId]

      return emitEvent(
        { ...currentCtx, state, events: [...currentCtx.events] },
        'PLOT_FAILED',
        'normal',
        [plot.leaderId],
        [leader.houseId],
        countryIds,
        `${leader.name}'s ${plot.type} plot failed.`,
      )
    }
  }
}

function startNewPlot(currentCtx: TickContext, houseId: HouseId): TickContext {
  const house = currentCtx.state.houses[houseId]
  if (!house || !house.active) return currentCtx

  const head = currentCtx.state.persons[house.headId]
  if (!head || !head.alive) return currentCtx

  // Check if house already has an active plot
  const hasActivePlot = Object.values(currentCtx.state.activePlots).some(
    (p) => p.leaderId === house.headId && p.status === 'active',
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
    plotType = 'seize_role'
  } else {
    plotType = 'replace_house_head'
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
  const durationMonths = plotType === 'prepare_rebellion' ? 6 : 3

  // Generate PlotId
  const { id: rawId, ctx: eventCtx } = makeEventId(ctx4)
  const plotId = rawId.replace(/^e-/, 'p-') as PlotId

  // Determine target fields based on plotType
  let targetHouseId: HouseId | undefined
  let targetCountryId: CountryId | undefined
  let targetRole: RoleType | undefined

  switch (plotType) {
    case 'replace_house_head': {
      const candidates: HouseId[] = []
      for (const cid of Object.keys(currentCtx.state.houses).sort()) {
        const candidateHouse = currentCtx.state.houses[cid as HouseId]
        if (!candidateHouse) continue
        if (cid === houseId) continue
        if (!candidateHouse.active) continue
        if (candidateHouse.countryId !== house.countryId) continue
        const candidateHead = currentCtx.state.persons[candidateHouse.headId]
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

    case 'seize_role': {
      const country = currentCtx.state.countries[house.countryId]
      if (country) {
        const allRoles: RoleType[] = ['chancellor', 'general', 'treasurer']
        let vacantRole: RoleType | undefined
        for (const role of allRoles) {
          const assignment = country.roleAssignments[role]
          if (!assignment) {
            vacantRole = role
            break
          }
        }
        if (vacantRole) {
          targetRole = vacantRole
        } else {
          targetRole = allRoles[0]
        }
      }
      targetCountryId = house.countryId
      break
    }

    case 'prepare_rebellion': {
      targetCountryId = house.countryId
      break
    }
  }

  // Build Plot object - only include defined optional fields
  const newPlot: Plot = {
    id: plotId,
    type: plotType,
    status: 'active',
    startedYear: eventCtx.state.currentYear,
    startedMonth: eventCtx.state.currentMonth,
    durationMonths,
    elapsedMonths: 0,
    leaderId: house.headId,
    participantIds: [house.headId],
    power,
    secrecy,
    risk,
    ...(targetHouseId !== undefined ? { targetHouseId } : {}),
    ...(targetCountryId !== undefined ? { targetCountryId } : {}),
    ...(targetRole !== undefined ? { targetRole } : {}),
  }

  const newActivePlots = { ...eventCtx.state.activePlots, [plotId]: newPlot }
  const newState = { ...eventCtx.state, activePlots: newActivePlots }

  // Emit PLOT_STARTED event
  const countryIds: CountryId[] = targetCountryId ? [targetCountryId] : [house.countryId]

  return emitEvent(
    { ...eventCtx, state: newState, events: [...eventCtx.events] },
    'PLOT_STARTED',
    'normal',
    [house.headId],
    [houseId],
    countryIds,
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

    const newElapsed = plot.elapsedMonths + 1

    if (newElapsed < plot.durationMonths) {
      const updatedPlots = { ...currentCtx.state.activePlots }
      updatedPlots[plotId as PlotId] = { ...plot, elapsedMonths: newElapsed }
      currentCtx = { ...currentCtx, state: { ...currentCtx.state, activePlots: updatedPlots } }
      continue
    }

    // Resolve the plot
    const result = resolvePlot(currentCtx, plot)
    const status: 'succeeded' | 'failed' = result.succeeded ? 'succeeded' : 'failed'

    const updatedPlots = { ...result.ctx.state.activePlots }
    updatedPlots[plotId as PlotId] = { ...plot, status, elapsedMonths: newElapsed }
    currentCtx = {
      ...result.ctx,
      state: { ...result.ctx.state, activePlots: updatedPlots },
    }
  }

  // === PHASE B: Start new plots ===
  const houseIds = Object.keys(ctx.state.houses).sort()

  for (const houseId of houseIds) {
    const scores = calcAmbitionScores(currentCtx.state, houseId as HouseId)
    if (scores.plotTendency < currentCtx.config.plotThreshold) continue

    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue

    const head = currentCtx.state.persons[house.headId]
    if (!head || !head.alive) continue

    const hasActivePlot = Object.values(currentCtx.state.activePlots).some(
      (p) => p.leaderId === house.headId && p.status === 'active',
    )
    if (hasActivePlot) continue

    currentCtx = startNewPlot(currentCtx, houseId as HouseId)
  }

  return currentCtx
}
