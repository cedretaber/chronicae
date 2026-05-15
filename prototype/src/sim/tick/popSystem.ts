import { clamp } from '../utils/math'
import type { TickContext } from './context'
import type { ProvinceId, PopGroupId } from '../types/ids'
import type { PopGroup } from '../types/popGroup'
import { getProvincePopulationPressure } from '../selectors/popSelectors'

export function normalizePopSizes(ctx: TickContext): TickContext {
  const minSizeByClass = ctx.config.minPopSizeByClass
  let newPopGroups: Record<PopGroupId, PopGroup> | undefined

  for (const popGroupId of Object.keys(ctx.state.popGroups).sort()) {
    const pop = ctx.state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    const minSize = minSizeByClass[pop.class]
    if (pop.size < minSize) {
      if (!newPopGroups) newPopGroups = { ...ctx.state.popGroups }
      newPopGroups[pop.id] = { ...pop, size: minSize }
    }
  }

  if (!newPopGroups) return ctx
  return { ...ctx, state: { ...ctx.state, popGroups: newPopGroups } }
}

export function runPopSystem(ctx: TickContext): TickContext {
  const newPopGroups: Record<PopGroupId, PopGroup> = { ...ctx.state.popGroups }

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const pressure = getProvincePopulationPressure(ctx.state, ctx.config, province.id)

    const baseMonthlyGrowthByClass = ctx.config.baseMonthlyGrowthByClass
    const minPopSizeByClass = ctx.config.minPopSizeByClass
    const populationPressureThreshold = ctx.config.populationPressureThreshold
    const populationPressureWealthPenalty = ctx.config.populationPressureWealthPenalty
    const populationPressureUnrestGain = ctx.config.populationPressureUnrestGain
    const povertyWealthThreshold = ctx.config.povertyWealthThreshold
    const povertyUnrestGain = ctx.config.povertyUnrestGain
    const prosperityWealthThreshold = ctx.config.prosperityWealthThreshold
    const prosperityUnrestReduction = ctx.config.prosperityUnrestReduction

    for (const popGroupId of province.popGroupIds) {
      const pop = ctx.state.popGroups[popGroupId]
      if (!pop) continue

      // 1. Population growth (§7.3)
      const growthFactor = clamp(1 - pressure, -0.5, 1.0)
      const baseGrowth = baseMonthlyGrowthByClass[pop.class]
      const wealthFactor = clamp(0.5 + pop.wealth / 100, 0.5, 1.5)
      const unrestFactor = clamp(1 - pop.unrest / 150, 0.3, 1)
      const delta = pop.size * baseGrowth * growthFactor * wealthFactor * unrestFactor
      const newSize = pop.size + delta

      // 2. Population pressure effect (§7.4)
      let newWealth = pop.wealth
      let newUnrest = pop.unrest

      if (pressure > populationPressureThreshold) {
        const excess = pressure - populationPressureThreshold
        newWealth = pop.wealth - excess * populationPressureWealthPenalty
        newUnrest = pop.unrest + excess * populationPressureUnrestGain
      }

      // 3. Poverty effect (§7.5)
      if (pop.wealth < povertyWealthThreshold) {
        newUnrest += (povertyWealthThreshold - pop.wealth) * povertyUnrestGain
      }

      // 4. Prosperity effect (§7.5)
      if (pop.wealth > prosperityWealthThreshold) {
        newUnrest -= (pop.wealth - prosperityWealthThreshold) * prosperityUnrestReduction
      }

      // 5. Clamp (§7.6)
      const finalSize = Math.max(minPopSizeByClass[pop.class], newSize)
      const finalWealth = clamp(newWealth, 0, 100)
      const finalUnrest = clamp(newUnrest, 0, 100)

      newPopGroups[pop.id] = {
        ...pop,
        size: finalSize,
        wealth: finalWealth,
        unrest: finalUnrest,
      }
    }
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      popGroups: newPopGroups,
    },
  }
}
