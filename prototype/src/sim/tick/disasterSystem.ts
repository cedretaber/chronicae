import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import type { ProvinceId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import {
  adjustProvincePopWealthByClass,
  adjustProvincePopSizeByClass,
  adjustProvincePopWealth,
  adjustProvincePopUnrestByClass,
} from '../mutations/popMutations'
import { adjustProvinceDevelopment } from '../mutations/provinceMutations'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'
import { getProvincePopulationPressure, getProvincePops } from '../selectors/popSelectors'

function applyFamine(ctx: TickContext, provinceId: ProvinceId): TickContext {
  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx

  let nextState = ctx.state
  const r = adjustProvinceDevelopment(nextState, provinceId, -ctx.config.famineDevastation)
  if (r.ok) nextState = r.value

  nextState = adjustProvincePopWealthByClass(
    nextState,
    provinceId,
    'peasants',
    -ctx.config.famineWealthPenalty,
  )
  const pops = getProvincePops(nextState, provinceId)
  for (const pop of pops) {
    if (pop.class !== 'peasants') continue
    nextState = adjustProvincePopSizeByClass(
      nextState,
      provinceId,
      'peasants',
      -pop.size * ctx.config.famineSizeDamageRate,
    )
  }

  const nextCtx = { ...ctx, state: nextState }
  const { event, ctx: eventCtx } = createSimEvent(nextCtx, {
    type: 'FAMINE',
    importance: 'major',
    messageKey: 'disaster.famine',
    messageParams: {
      province: nameParam('province', province.nameKey, province.name),
    },
    entityRefs: [entityRef('province', provinceId, 'province', province.nameKey)],
  })
  return { ...eventCtx, state: nextState, events: [...eventCtx.events, event] }
}

function applyPlague(ctx: TickContext, provinceId: ProvinceId): TickContext {
  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx

  let nextState = ctx.state
  const r = adjustProvinceDevelopment(nextState, provinceId, -ctx.config.plagueDevastation)
  if (r.ok) nextState = r.value

  nextState = adjustProvincePopWealth(nextState, provinceId, -ctx.config.plagueWealthPenalty)
  const pops = getProvincePops(nextState, provinceId)
  for (const pop of pops) {
    nextState = adjustProvincePopSizeByClass(
      nextState,
      provinceId,
      pop.class,
      -pop.size * ctx.config.plagueSizeDamageRate,
    )
  }

  const nextCtx = { ...ctx, state: nextState }
  const { event, ctx: eventCtx } = createSimEvent(nextCtx, {
    type: 'PLAGUE',
    importance: 'major',
    messageKey: 'disaster.plague',
    messageParams: {
      province: nameParam('province', province.nameKey, province.name),
    },
    entityRefs: [entityRef('province', provinceId, 'province', province.nameKey)],
  })
  return { ...eventCtx, state: nextState, events: [...eventCtx.events, event] }
}

function applyBountifulHarvest(ctx: TickContext, provinceId: ProvinceId): TickContext {
  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx

  let nextState = ctx.state
  const r = adjustProvinceDevelopment(
    nextState,
    provinceId,
    ctx.config.bountifulHarvestDevelopmentGain,
  )
  if (r.ok) nextState = r.value

  nextState = adjustProvincePopWealthByClass(
    nextState,
    provinceId,
    'peasants',
    ctx.config.bountifulHarvestPeasantWealthGain,
  )
  nextState = adjustProvincePopUnrestByClass(
    nextState,
    provinceId,
    'peasants',
    -ctx.config.bountifulHarvestPeasantUnrestReduction,
  )
  nextState = adjustProvincePopWealthByClass(
    nextState,
    provinceId,
    'townsmen',
    ctx.config.bountifulHarvestTownsmanWealthGain,
  )
  nextState = adjustProvincePopUnrestByClass(
    nextState,
    provinceId,
    'townsmen',
    -ctx.config.bountifulHarvestTownsmanUnrestReduction,
  )

  const nextCtx = { ...ctx, state: nextState }
  const { event, ctx: eventCtx } = createSimEvent(nextCtx, {
    type: 'BOUNTIFUL_HARVEST',
    importance: 'normal',
    messageKey: 'disaster.bountiful_harvest',
    messageParams: {
      province: nameParam('province', province.nameKey, province.name),
    },
    entityRefs: [entityRef('province', provinceId, 'province', province.nameKey)],
  })
  return { ...eventCtx, state: nextState, events: [...eventCtx.events, event] }
}

export function runDisasterSystem(ctx: TickContext): TickContext {
  if (!ctx.config.disasterEnabled) return ctx

  let currentCtx = ctx

  for (const provinceIdStr of Object.keys(ctx.state.provinces).sort()) {
    const provinceId = provinceIdStr as ProvinceId
    const province = ctx.state.provinces[provinceId]
    if (!province) continue

    const terminalPolityId = getProvinceTerminalPolityId(currentCtx.state, provinceId)
    if (!terminalPolityId) continue
    const polity = currentCtx.state.polities[terminalPolityId]
    if (!polity || !polity.active) continue

    const pressure = getProvincePopulationPressure(currentCtx.state, currentCtx.config, provinceId)
    const pressureExcess = Math.max(0, pressure - ctx.config.populationPressureThreshold)

    const famineChance =
      ctx.config.famineBaseChancePerYear + ctx.config.faminePressureChanceBonus * pressureExcess
    const plagueChance =
      ctx.config.plagueBaseChancePerYear + ctx.config.plaguePressureChanceBonus * pressureExcess

    const { value: famineRoll, rng: rng1 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng1 }

    const { value: plagueRoll, rng: rng2 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng2 }

    const { value: harvestRoll, rng: rng3 } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rng3 }

    if (famineRoll < famineChance) {
      currentCtx = applyFamine(currentCtx, provinceId)
    }

    if (plagueRoll < plagueChance) {
      currentCtx = applyPlague(currentCtx, provinceId)
    }

    if (harvestRoll < ctx.config.bountifulHarvestBaseChancePerYear) {
      currentCtx = applyBountifulHarvest(currentCtx, provinceId)
    }
  }

  return currentCtx
}
