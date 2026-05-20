import { clamp } from '../utils/math'
import type { TickContext } from './context'
import type { HoldingId } from '../types/ids'

export function runDevelopmentSystem(ctx: TickContext): TickContext {
  const newHoldings = { ...ctx.state.holdings }

  for (const holdingId of Object.keys(ctx.state.holdings).sort()) {
    const holding = ctx.state.holdings[holdingId as HoldingId]
    if (!holding) continue

    let { development } = holding

    if (development > 0) {
      development = Math.max(0, development - ctx.config.developmentPositiveMonthlyDecay)
    } else if (development < 0) {
      development = Math.min(0, development + ctx.config.developmentNegativeMonthlyRecovery)
    }

    development = clamp(development, -100, 100)

    newHoldings[holdingId as HoldingId] = { ...holding, development }
  }

  return {
    ...ctx,
    state: {
      ...ctx.state,
      holdings: newHoldings,
    },
  }
}
