import { clamp } from '../utils/math'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopGroupId, ProvinceId } from '../types/ids'
import {
  getProvincePopulationPressure,
  getHoldingClassCapacity,
  getHoldingEmployedPopSize,
} from '../selectors/popSelectors'
import { addToOrCreatePopGroupMut, removePopGroupMut } from '../mutations/popMutations'

export function normalizePopSizes(ctx: TickContext): TickContext {
  const minSizeByClass = ctx.config.minPopSizeByClass
  const epsilon = ctx.config.popSizeEpsilon
  let changed = false

  // Check if any changes are needed
  for (const popGroupId of Object.keys(ctx.state.popGroups).sort()) {
    const pop = ctx.state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    if (pop.employed && pop.size < minSizeByClass[pop.class]) {
      changed = true
      break
    }
    if (!pop.employed && pop.size <= epsilon) {
      changed = true
      break
    }
  }

  if (!changed) return ctx

  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
  }

  // Collect unemployed POPs to remove (can't modify while iterating)
  const toRemove: PopGroupId[] = []

  for (const popGroupId of Object.keys(ws.popGroups).sort() as PopGroupId[]) {
    const pop = ws.popGroups[popGroupId]
    if (!pop) continue

    if (pop.employed) {
      const minSize = minSizeByClass[pop.class]
      if (pop.size < minSize) {
        ws.popGroups[pop.id] = { ...pop, size: minSize }
      }
    } else {
      if (pop.size <= epsilon) {
        toRemove.push(pop.id)
      }
    }
  }

  for (const popId of toRemove) {
    removePopGroupMut(ws, popId)
  }

  return { ...ctx, state: ws }
}

export function runPopSystem(ctx: TickContext): TickContext {
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  // Snapshot POP IDs before loop — new POPs created by overflow won't be processed
  const popIdSnapshot = Object.keys(ws.popGroups).sort() as PopGroupId[]

  // Pre-compute pressure per province
  const pressureByProvince = new Map<string, number>()
  for (const provinceId of Object.keys(ws.provinces).sort()) {
    pressureByProvince.set(
      provinceId,
      getProvincePopulationPressure(ws, ctx.config, provinceId as ProvinceId),
    )
  }

  for (const popGroupId of popIdSnapshot) {
    const pop = ws.popGroups[popGroupId]
    if (!pop) continue

    const holding = ws.holdings[pop.holdingId]
    if (!holding) continue

    const pressure = pressureByProvince.get(holding.provinceId) ?? 0

    // 1. Population growth
    const growthFactor = clamp(1 - pressure * pressure, -0.5, 1.0)
    const baseGrowth = ctx.config.baseMonthlyGrowthByClass[pop.class]
    const wealthFactor = clamp(0.5 + pop.wealth / 100, 0.5, 1.5)
    const unrestFactor = clamp(1 - pop.unrest / 150, 0.3, 1)

    const employmentGrowthModifier: number = pop.employed
      ? 1
      : ctx.config.unemployedGrowthModifierByClass[pop.class]

    const delta =
      pop.size * baseGrowth * growthFactor * wealthFactor * unrestFactor * employmentGrowthModifier

    // 2. Apply growth with overflow
    let newSize: number
    if (delta <= 0) {
      newSize = Math.max(0, pop.size + delta)
    } else if (!pop.employed) {
      newSize = pop.size + delta
    } else {
      const capacity = getHoldingClassCapacity(ws, ctx.config, pop.holdingId, pop.class)
      const current = getHoldingEmployedPopSize(ws, pop.holdingId, pop.class)
      const room = Math.max(0, capacity - current)
      const toOriginal = Math.min(delta, room)
      const overflow = delta - toOriginal

      newSize = pop.size + toOriginal

      if (overflow > 0) {
        addToOrCreatePopGroupMut(ws, {
          holdingId: pop.holdingId,
          class: pop.class,
          employed: false,
          size: overflow,
          inheritFrom: pop,
        })
      }
    }

    // 3. Population pressure effect
    let newWealth = pop.wealth
    let newUnrest = pop.unrest

    if (pressure > ctx.config.populationPressureThreshold) {
      const excess = pressure - ctx.config.populationPressureThreshold
      newWealth = pop.wealth - excess * ctx.config.populationPressureWealthPenalty
      newUnrest = pop.unrest + excess * ctx.config.populationPressureUnrestGain
    }

    // 4. Poverty effect
    if (pop.wealth < ctx.config.povertyWealthThreshold) {
      newUnrest += (ctx.config.povertyWealthThreshold - pop.wealth) * ctx.config.povertyUnrestGain
    }

    // 5. Prosperity effect
    if (pop.wealth > ctx.config.prosperityWealthThreshold) {
      newUnrest -=
        (pop.wealth - ctx.config.prosperityWealthThreshold) * ctx.config.prosperityUnrestReduction
    }

    // 5.5. Natural unrest decay
    newUnrest *= 1 - ctx.config.unrestNaturalDecayRate

    // 6. Unemployed POP penalties
    if (!pop.employed) {
      newWealth -= ctx.config.unemployedWealthDecayByClass[pop.class]
      newUnrest += ctx.config.unemployedUnrestGainByClass[pop.class]
    }

    // 7. Clamp
    const minSize = ctx.config.minPopSizeByClass[pop.class]
    const finalSize = pop.employed ? Math.max(minSize, newSize) : Math.max(0, newSize)
    const finalWealth = clamp(newWealth, 0, 100)
    const finalUnrest = clamp(newUnrest, 0, 100)

    ws.popGroups[pop.id] = {
      ...pop,
      size: finalSize,
      wealth: finalWealth,
      unrest: finalUnrest,
    }
  }

  return { ...ctx, state: ws }
}
