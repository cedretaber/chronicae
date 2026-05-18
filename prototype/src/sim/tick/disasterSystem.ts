import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import type { PolityId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'
import {
  adjustProvincePopWealthByClass,
  adjustProvincePopSizeByClass,
  adjustProvincePopWealth,
  adjustProvincePopSize,
  adjustProvincePopUnrestByClass,
} from '../mutations/popMutations'
import { adjustProvinceDevelopment } from '../mutations/provinceMutations'
import { adjustPolityLegacyPrestige } from '../helpers/attitudeHelpers'
import { adjustPopAttitude } from '../mutations/attitudeMutations'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'

function applyFamine(ctx: TickContext, polityId: PolityId): TickContext {
  const polity = ctx.state.polities[polityId]
  if (!polity) return ctx

  const polityProvinceIds: ProvinceId[] = Object.keys(ctx.state.provinces)
    .filter((pid) => {
      const province = ctx.state.provinces[pid as ProvinceId]
      if (!province) return false
      return getProvinceTerminalPolityId(ctx.state, pid as ProvinceId) === polityId
    })
    .map((pid) => pid as ProvinceId)

  const reliefCost = polityProvinceIds.length * ctx.config.disasterReliefCostPerProvince
  const canAffordRelief = polity.treasury >= reliefCost

  const developmentDelta = canAffordRelief
    ? ctx.config.famineDevastation - ctx.config.famineReliefDevelopmentRecovery
    : ctx.config.famineDevastation

  let stateWithDev = ctx.state
  for (const pid of polityProvinceIds) {
    const r = adjustProvinceDevelopment(stateWithDev, pid, -developmentDelta)
    if (r.ok) stateWithDev = r.value
  }

  const treasuryAfterRelief = canAffordRelief
    ? Math.max(0, polity.treasury - reliefCost)
    : polity.treasury

  const updatedPolity = {
    ...polity,
    treasury: treasuryAfterRelief,
  }

  const stateWithPolity = {
    ...stateWithDev,
    polities: { ...stateWithDev.polities, [polityId]: updatedPolity },
  }

  // Apply legacyPrestige and attitude changes based on relief
  let nextCtxState = stateWithPolity
  const polityTarget = { kind: 'polity' as const, id: polityId }
  if (canAffordRelief) {
    nextCtxState = adjustPolityLegacyPrestige(nextCtxState, polityId, 1)
    // Affected provinces pop attitudes
    for (const pid of polityProvinceIds) {
      const prov = nextCtxState.provinces[pid]
      if (!prov) continue
      for (const popId of prov.popGroupIds) {
        const r = adjustPopAttitude(nextCtxState, popId, polityTarget, {
          affection: 6,
          respect: 2,
        })
        if (r.ok) nextCtxState = r.value
      }
    }
  } else {
    for (const pid of polityProvinceIds) {
      const prov = nextCtxState.provinces[pid]
      if (!prov) continue
      for (const popId of prov.popGroupIds) {
        const r = adjustPopAttitude(nextCtxState, popId, polityTarget, {
          affection: -8,
          respect: -4,
        })
        if (r.ok) nextCtxState = r.value
      }
    }
  }

  const nextCtx = { ...ctx, state: nextCtxState }

  const wealthDamage =
    ctx.config.famineWealthPenalty * (canAffordRelief ? ctx.config.famineReliefDamageMultiplier : 1)
  const sizeDamage =
    ctx.config.famineSizeDamage * (canAffordRelief ? ctx.config.famineReliefDamageMultiplier : 1)
  let stateWithPopEffects = nextCtx.state
  for (const pid of polityProvinceIds) {
    stateWithPopEffects = adjustProvincePopWealthByClass(
      stateWithPopEffects,
      pid,
      'peasants',
      -wealthDamage,
    )
    stateWithPopEffects = adjustProvincePopSizeByClass(
      stateWithPopEffects,
      pid,
      'peasants',
      -sizeDamage,
    )
  }

  const eventSourceCtx = { ...nextCtx, state: stateWithPopEffects }
  const { id: eventId, ctx: eventCtx } = makeEventId(eventSourceCtx)
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type: 'FAMINE',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: polityProvinceIds,
    summary: `Famine strikes ${polity.name}!`,
    reasons: [],
    effects: [],
  }
  const eventUpdatedCtx = {
    ...eventCtx,
    state: eventSourceCtx.state,
    events: [...eventCtx.events, event],
  }

  const reliefEventType = canAffordRelief ? 'DISASTER_RELIEF_FUNDED' : 'DISASTER_RELIEF_FAILED'
  const reliefSummary = canAffordRelief
    ? `${polity.name} funded disaster relief.`
    : `${polity.name} failed to fund disaster relief.`
  const { id: reliefId, ctx: reliefCtx } = makeEventId(eventUpdatedCtx)
  const reliefEvent: SimEvent = {
    id: reliefId,
    year: reliefCtx.state.currentYear,
    month: reliefCtx.state.currentMonth,
    type: reliefEventType,
    importance: 'normal',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: [],
    summary: reliefSummary,
    reasons: [],
    effects: [],
  }
  return { ...reliefCtx, state: eventUpdatedCtx.state, events: [...reliefCtx.events, reliefEvent] }
}

function applyPlague(ctx: TickContext, polityId: PolityId): TickContext {
  const polity = ctx.state.polities[polityId]
  if (!polity) return ctx

  const polityProvinceIds: ProvinceId[] = Object.keys(ctx.state.provinces)
    .filter((pid) => {
      const province = ctx.state.provinces[pid as ProvinceId]
      if (!province) return false
      return getProvinceTerminalPolityId(ctx.state, pid as ProvinceId) === polityId
    })
    .map((pid) => pid as ProvinceId)

  let stateWithDev = ctx.state
  for (const pid of polityProvinceIds) {
    const r = adjustProvinceDevelopment(stateWithDev, pid, -ctx.config.plagueDevastation)
    if (r.ok) stateWithDev = r.value
  }

  const nextCtx = { ...ctx, state: stateWithDev }
  let stateWithPopEffects = nextCtx.state
  for (const pid of polityProvinceIds) {
    stateWithPopEffects = adjustProvincePopWealth(
      stateWithPopEffects,
      pid,
      -ctx.config.plagueWealthPenalty,
    )
    stateWithPopEffects = adjustProvincePopSize(
      stateWithPopEffects,
      pid,
      -ctx.config.plagueSizeDamage,
    )
  }

  const { id: eventId, ctx: eventCtx } = makeEventId({ ...nextCtx, state: stateWithPopEffects })
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type: 'PLAGUE',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: polityProvinceIds,
    summary: `Plague spreads through ${polity.name}!`,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, state: stateWithPopEffects, events: [...eventCtx.events, event] }
}

function applyBountifulHarvest(ctx: TickContext, polityId: PolityId): TickContext {
  const polity = ctx.state.polities[polityId]
  if (!polity) return ctx

  const polityProvinceIds: ProvinceId[] = Object.keys(ctx.state.provinces)
    .filter((pid) => getProvinceTerminalPolityId(ctx.state, pid as ProvinceId) === polityId)
    .map((pid) => pid as ProvinceId)

  let stateWithDev = ctx.state
  for (const pid of polityProvinceIds) {
    const r = adjustProvinceDevelopment(
      stateWithDev,
      pid,
      ctx.config.bountifulHarvestDevelopmentGain,
    )
    if (r.ok) stateWithDev = r.value
  }

  const nextCtxHarvest = { ...ctx, state: stateWithDev }
  let stateWithPopEffects = nextCtxHarvest.state
  for (const pid of polityProvinceIds) {
    stateWithPopEffects = adjustProvincePopWealthByClass(
      stateWithPopEffects,
      pid,
      'peasants',
      ctx.config.bountifulHarvestPeasantWealthGain,
    )
    stateWithPopEffects = adjustProvincePopUnrestByClass(
      stateWithPopEffects,
      pid,
      'peasants',
      -ctx.config.bountifulHarvestPeasantUnrestReduction,
    )
    stateWithPopEffects = adjustProvincePopWealthByClass(
      stateWithPopEffects,
      pid,
      'townsmen',
      ctx.config.bountifulHarvestTownsmanWealthGain,
    )
    stateWithPopEffects = adjustProvincePopUnrestByClass(
      stateWithPopEffects,
      pid,
      'townsmen',
      -ctx.config.bountifulHarvestTownsmanUnrestReduction,
    )
  }

  const { id: eventId, ctx: eventCtx } = makeEventId({
    ...nextCtxHarvest,
    state: stateWithPopEffects,
  })
  const event: SimEvent = {
    id: eventId,
    year: eventCtx.state.currentYear,
    month: eventCtx.state.currentMonth,
    type: 'BOUNTIFUL_HARVEST',
    importance: 'normal',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: polityProvinceIds,
    summary: `A bountiful harvest blesses ${polity.name}.`,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, state: stateWithPopEffects, events: [...eventCtx.events, event] }
}

export function runDisasterSystem(ctx: TickContext): TickContext {
  if (!ctx.config.disasterEnabled) return ctx
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx
  const state = ctx.state

  for (const polityId of Object.keys(state.polities).sort()) {
    const polity = state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue

    const { value: famineRoll, rng: rng1 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng1 }

    const { value: plagueRoll, rng: rng2 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng2 }

    const { value: harvestRoll, rng: rng3 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng3 }

    if (famineRoll < ctx.config.famineBaseChancePerYear) {
      currentCtx = applyFamine(currentCtx, polityId as PolityId)
    }

    if (plagueRoll < ctx.config.plagueBaseChancePerYear) {
      currentCtx = applyPlague(currentCtx, polityId as PolityId)
    }

    if (harvestRoll < ctx.config.bountifulHarvestBaseChancePerYear) {
      currentCtx = applyBountifulHarvest(currentCtx, polityId as PolityId)
    }
  }

  return currentCtx
}
