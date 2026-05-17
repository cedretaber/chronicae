import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import type { CountryId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'
import {
  adjustProvincePopWealthByClass,
  adjustProvincePopSizeByClass,
  adjustProvincePopWealth,
  adjustProvincePopSize,
  adjustProvincePopUnrestByClass,
} from '../mutations/popMutations'
import { adjustProvinceDevelopment } from '../mutations/provinceMutations'
import {
  adjustCountryLegacyPrestige,
  adjustAttitude,
  countryAttitudeKey,
} from '../helpers/attitudeHelpers'

function applyFamine(ctx: TickContext, countryId: CountryId): TickContext {
  const country = ctx.state.countries[countryId]
  if (!country) return ctx

  const countryProvinceIds: ProvinceId[] = Object.keys(ctx.state.provinces)
    .filter((pid) => {
      const province = ctx.state.provinces[pid as ProvinceId]
      return province?.countryId === countryId
    })
    .map((pid) => pid as ProvinceId)

  const reliefCost = countryProvinceIds.length * ctx.config.disasterReliefCostPerProvince
  const canAffordRelief = country.treasury >= reliefCost

  const developmentDelta = canAffordRelief
    ? ctx.config.famineDevastation - ctx.config.famineReliefDevelopmentRecovery
    : ctx.config.famineDevastation

  let stateWithDev = ctx.state
  for (const pid of countryProvinceIds) {
    const r = adjustProvinceDevelopment(stateWithDev, pid, -developmentDelta)
    if (r.ok) stateWithDev = r.value
  }

  const treasuryAfterRelief = canAffordRelief
    ? Math.max(0, country.treasury - reliefCost)
    : country.treasury

  const updatedCountry = {
    ...country,
    treasury: treasuryAfterRelief,
  }

  const stateWithCountry = {
    ...stateWithDev,
    countries: { ...stateWithDev.countries, [countryId]: updatedCountry },
  }

  // Apply legacyPrestige and attitude changes based on relief
  let nextCtxState = stateWithCountry
  if (canAffordRelief) {
    nextCtxState = adjustCountryLegacyPrestige(nextCtxState, countryId, 1)
    // Affected provinces pop attitudes
    for (const pid of countryProvinceIds) {
      const prov = nextCtxState.provinces[pid]
      if (!prov) continue
      const cKey = countryAttitudeKey(countryId)
      const newPops = { ...nextCtxState.popGroups }
      for (const popId of prov.popGroupIds) {
        const pop = newPops[popId]
        if (!pop) continue
        newPops[popId] = {
          ...pop,
          attitudes: adjustAttitude(pop.attitudes, cKey, { affection: 6, respect: 2 }),
        }
      }
      nextCtxState = { ...nextCtxState, popGroups: newPops }
    }
  } else {
    const cKey = countryAttitudeKey(countryId)
    for (const pid of countryProvinceIds) {
      const prov = nextCtxState.provinces[pid]
      if (!prov) continue
      const newPops = { ...nextCtxState.popGroups }
      for (const popId of prov.popGroupIds) {
        const pop = newPops[popId]
        if (!pop) continue
        newPops[popId] = {
          ...pop,
          attitudes: adjustAttitude(pop.attitudes, cKey, { affection: -8, respect: -4 }),
        }
      }
      nextCtxState = { ...nextCtxState, popGroups: newPops }
    }
  }

  const nextCtx = { ...ctx, state: nextCtxState }

  const wealthDamage =
    ctx.config.famineWealthPenalty * (canAffordRelief ? ctx.config.famineReliefDamageMultiplier : 1)
  const sizeDamage =
    ctx.config.famineSizeDamage * (canAffordRelief ? ctx.config.famineReliefDamageMultiplier : 1)
  let stateWithPopEffects = nextCtx.state
  for (const pid of countryProvinceIds) {
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
    countryIds: [countryId],
    provinceIds: countryProvinceIds,
    summary: `Famine strikes ${country.name}!`,
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
    ? `${country.name} funded disaster relief.`
    : `${country.name} failed to fund disaster relief.`
  const { id: reliefId, ctx: reliefCtx } = makeEventId(eventUpdatedCtx)
  const reliefEvent: SimEvent = {
    id: reliefId,
    year: reliefCtx.state.currentYear,
    month: reliefCtx.state.currentMonth,
    type: reliefEventType,
    importance: 'normal',
    actorIds: [],
    houseIds: [],
    countryIds: [countryId],
    provinceIds: [],
    summary: reliefSummary,
    reasons: [],
    effects: [],
  }
  return { ...reliefCtx, state: eventUpdatedCtx.state, events: [...reliefCtx.events, reliefEvent] }
}

function applyPlague(ctx: TickContext, countryId: CountryId): TickContext {
  const country = ctx.state.countries[countryId]
  if (!country) return ctx

  const countryProvinceIds: ProvinceId[] = Object.keys(ctx.state.provinces)
    .filter((pid) => {
      const province = ctx.state.provinces[pid as ProvinceId]
      return province?.countryId === countryId
    })
    .map((pid) => pid as ProvinceId)

  let stateWithDev = ctx.state
  for (const pid of countryProvinceIds) {
    const r = adjustProvinceDevelopment(stateWithDev, pid, -ctx.config.plagueDevastation)
    if (r.ok) stateWithDev = r.value
  }

  const nextCtx = { ...ctx, state: stateWithDev }
  let stateWithPopEffects = nextCtx.state
  for (const pid of countryProvinceIds) {
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
    countryIds: [countryId],
    provinceIds: countryProvinceIds,
    summary: `Plague spreads through ${country.name}!`,
    reasons: [],
    effects: [],
  }
  return { ...eventCtx, state: stateWithPopEffects, events: [...eventCtx.events, event] }
}

function applyBountifulHarvest(ctx: TickContext, countryId: CountryId): TickContext {
  const country = ctx.state.countries[countryId]
  if (!country) return ctx

  const countryProvinceIds: ProvinceId[] = Object.keys(ctx.state.provinces)
    .filter((pid) => ctx.state.provinces[pid as ProvinceId]?.countryId === countryId)
    .map((pid) => pid as ProvinceId)

  let stateWithDev = ctx.state
  for (const pid of countryProvinceIds) {
    const r = adjustProvinceDevelopment(
      stateWithDev,
      pid,
      ctx.config.bountifulHarvestDevelopmentGain,
    )
    if (r.ok) stateWithDev = r.value
  }

  const nextCtxHarvest = { ...ctx, state: stateWithDev }
  let stateWithPopEffects = nextCtxHarvest.state
  for (const pid of countryProvinceIds) {
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
    countryIds: [countryId],
    provinceIds: countryProvinceIds,
    summary: `A bountiful harvest blesses ${country.name}.`,
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

  for (const countryId of Object.keys(state.countries).sort()) {
    const country = state.countries[countryId as CountryId]
    if (!country || !country.active) continue

    const { value: famineRoll, rng: rng1 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng1 }

    const { value: plagueRoll, rng: rng2 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng2 }

    const { value: harvestRoll, rng: rng3 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng3 }

    if (famineRoll < ctx.config.famineBaseChancePerYear) {
      currentCtx = applyFamine(currentCtx, countryId as CountryId)
    }

    if (plagueRoll < ctx.config.plagueBaseChancePerYear) {
      currentCtx = applyPlague(currentCtx, countryId as CountryId)
    }

    if (harvestRoll < ctx.config.bountifulHarvestBaseChancePerYear) {
      currentCtx = applyBountifulHarvest(currentCtx, countryId as CountryId)
    }
  }

  return currentCtx
}
