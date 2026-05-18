import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import { getProvinceAveragePopWealth, getProvinceUnrest } from '../selectors/popSelectors'
import { adjustProvincePopWealth } from '../mutations/popMutations'
import type { ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'

export function runPopDevelopmentSystem(ctx: TickContext): TickContext {
  if (!ctx.config.popDevelopmentEnabled) return ctx

  let currentCtx = ctx

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const averageWealth = getProvinceAveragePopWealth(currentCtx.state, provinceId as ProvinceId)
    const unrest = getProvinceUnrest(currentCtx.state, provinceId as ProvinceId)

    if (averageWealth < currentCtx.config.popDevelopmentWealthThreshold) continue
    if (unrest > currentCtx.config.popDevelopmentUnrestMax) continue
    if (province.development >= currentCtx.config.popDevelopmentMaxDevelopment) continue

    const chance = clamp(
      currentCtx.config.popDevelopmentMonthlyChance +
        (averageWealth - currentCtx.config.popDevelopmentWealthThreshold) *
          currentCtx.config.popDevelopmentWealthChanceFactor -
        unrest * currentCtx.config.popDevelopmentUnrestPenaltyFactor,
      0,
      currentCtx.config.popDevelopmentMaxMonthlyChance,
    )

    const { value: roll, rng: rng1 } = randomFloat(currentCtx.rng)
    if (roll >= chance) continue

    const newRng = rng1
    const newCtx = { ...currentCtx, rng: newRng }

    const newDev = clamp(province.development + currentCtx.config.popDevelopmentGain, -100, 100)

    const newProvinces = {
      ...newCtx.state.provinces,
      [provinceId]: { ...province, development: newDev },
    }

    const updatedState = adjustProvincePopWealth(
      { ...newCtx.state, provinces: newProvinces },
      provinceId as ProvinceId,
      -currentCtx.config.popDevelopmentCost,
    )

    const { id: eventId, ctx: eventCtx } = makeEventId({
      ...newCtx,
      state: updatedState,
    })

    const event: SimEvent = {
      id: eventId,
      year: eventCtx.state.currentYear,
      month: eventCtx.state.currentMonth,
      type: 'POP_LAND_DEVELOPED',
      importance: 'minor',
      actorIds: [],
      houseIds: [],
      polityIds: [],
      provinceIds: [provinceId as ProvinceId],
      summary: `The people of ${province.name} improved their lands.`,
      reasons: [],
      effects: [],
    }

    currentCtx = {
      ...eventCtx,
      state: eventCtx.state,
      events: [...eventCtx.events, event],
    }
  }

  return currentCtx
}
