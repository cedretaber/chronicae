import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp, clamp100 } from '../utils/math'
import type { CountryId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'

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

  const unrestDelta = canAffordRelief ? 5 : 15
  const newProvinces = { ...ctx.state.provinces }

  const developmentDelta = canAffordRelief
    ? ctx.config.famineDevastation - ctx.config.famineReliefDevelopmentRecovery
    : ctx.config.famineDevastation

  for (const pid of countryProvinceIds) {
    const province = newProvinces[pid]
    if (!province) continue
    newProvinces[pid] = {
      ...province,
      unrest: clamp100(province.unrest + unrestDelta),
      development: clamp(province.development - developmentDelta, -100, 100),
    }
  }

  const treasuryAfterRelief = canAffordRelief
    ? Math.max(0, country.treasury - reliefCost)
    : country.treasury
  const legitimacyDelta = canAffordRelief ? 5 : -8

  const updatedCountry = {
    ...country,
    treasury: treasuryAfterRelief,
    stability: clamp100(country.stability - 10),
    legitimacy: clamp100(country.legitimacy + legitimacyDelta),
  }

  const nextCtx = {
    ...ctx,
    state: {
      ...ctx.state,
      provinces: newProvinces,
      countries: { ...ctx.state.countries, [countryId]: updatedCountry },
    },
  }

  const { id: eventId, ctx: eventCtx } = makeEventId(nextCtx)
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
  const eventUpdatedCtx = { ...eventCtx, state: nextCtx.state, events: [...eventCtx.events, event] }

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

  const newProvinces = { ...ctx.state.provinces }

  for (const pid of countryProvinceIds) {
    const province = newProvinces[pid]
    if (!province) continue
    newProvinces[pid] = {
      ...province,
      unrest: clamp100(province.unrest + 10),
      development: clamp(province.development - ctx.config.plagueDevastation, -100, 100),
    }
  }

  const updatedCountry = { ...country, stability: clamp100(country.stability - 8) }

  const nextCtx = {
    ...ctx,
    state: {
      ...ctx.state,
      provinces: newProvinces,
      countries: { ...ctx.state.countries, [countryId]: updatedCountry },
    },
  }

  const { id: eventId, ctx: eventCtx } = makeEventId(nextCtx)
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
  return { ...eventCtx, state: nextCtx.state, events: [...eventCtx.events, event] }
}

function applyBountifulHarvest(ctx: TickContext, countryId: CountryId): TickContext {
  const country = ctx.state.countries[countryId]
  if (!country) return ctx

  const countryProvinces = Object.values(ctx.state.provinces).filter(
    (p) => p.countryId === countryId,
  )
  const taxBonus = countryProvinces.reduce((sum, p) => sum + p.baseTax, 0) * 0.5

  const newProvinces = { ...ctx.state.provinces }
  const countryProvinceIds: ProvinceId[] = []

  for (const pid of Object.keys(ctx.state.provinces)) {
    const province = ctx.state.provinces[pid as ProvinceId]
    if (!province || province.countryId !== countryId) continue
    countryProvinceIds.push(pid as ProvinceId)
    newProvinces[pid as ProvinceId] = {
      ...province,
      unrest: Math.max(0, province.unrest - 5),
      development: clamp(
        province.development + ctx.config.bountifulHarvestDevelopmentGain,
        -100,
        100,
      ),
    }
  }

  const updatedCountry = {
    ...country,
    treasury: country.treasury + taxBonus,
    stability: clamp100(country.stability + 5),
  }

  const nextCtxHarvest = {
    ...ctx,
    state: {
      ...ctx.state,
      provinces: newProvinces,
      countries: { ...ctx.state.countries, [countryId]: updatedCountry },
    },
  }

  const { id: eventId, ctx: eventCtx } = makeEventId(nextCtxHarvest)
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
  return { ...eventCtx, state: nextCtxHarvest.state, events: [...eventCtx.events, event] }
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
