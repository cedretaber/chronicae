import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import type { PopClass } from '../types/popGroup'
import type { ProvinceId } from '../types/ids'
import type { WorldState } from '../types/world'
import { getProvinceAveragePopWealth, getProvinceUnrest } from '../selectors/popSelectors'
import { adjustProvincePopWealth } from '../mutations/popMutations'
import { getProvinceHoldings, getProvinceHoldingsByKind } from '../selectors/landContractSelectors'
import { nameParam, entityRef } from '../types/event'

function getDominantPopClass(state: WorldState, provinceId: ProvinceId): PopClass {
  const province = state.provinces[provinceId]
  if (!province) return 'peasants'
  let bestClass: PopClass = 'peasants'
  let bestSize = 0
  for (const pgId of province.popGroupIds) {
    const pg = state.popGroups[pgId]
    if (!pg) continue
    if (pg.size > bestSize) {
      bestSize = pg.size
      bestClass = pg.class
    }
  }
  return bestClass
}

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
    const dominantClass = getDominantPopClass(currentCtx.state, provinceId as ProvinceId)
    const preferredKind: 'manor' | 'city' = dominantClass === 'townsmen' ? 'city' : 'manor'
    const kindHoldings = getProvinceHoldingsByKind(
      currentCtx.state,
      provinceId as ProvinceId,
      preferredKind,
    )
    const allHoldings = getProvinceHoldings(currentCtx.state, provinceId as ProvinceId)
    const candidates = kindHoldings.length > 0 ? kindHoldings : allHoldings
    if (candidates.length === 0) continue
    const targetHolding = candidates.reduce((best, h) =>
      h.development < best.development ? h : best,
    )

    if (targetHolding.development >= currentCtx.config.popDevelopmentMaxDevelopment) continue

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

    const newDev = clamp(
      targetHolding.development + currentCtx.config.popDevelopmentGain,
      -100,
      100,
    )

    const newHoldings = {
      ...newCtx.state.holdings,
      [targetHolding.id]: { ...targetHolding, development: newDev },
    }

    const updatedState = adjustProvincePopWealth(
      { ...newCtx.state, holdings: newHoldings },
      provinceId as ProvinceId,
      -currentCtx.config.popDevelopmentCost,
    )

    const { event, ctx: eventCtx } = createSimEvent(
      {
        ...newCtx,
        state: updatedState,
      },
      {
        type: 'POP_LAND_DEVELOPED',
        importance: 'minor',
        messageKey: 'pop.land_developed',
        messageParams: {
          province: nameParam('province', province.nameKey, province.name),
        },
        entityRefs: [entityRef('province', provinceId, 'province', province?.nameKey)],
      },
    )

    currentCtx = {
      ...eventCtx,
      state: eventCtx.state,
      events: [...eventCtx.events, event],
    }
  }

  return currentCtx
}
