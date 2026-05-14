import type { TickContext } from './context'

export function advanceTime(ctx: TickContext): TickContext {
  const newMonth = ctx.state.currentMonth + 1
  if (newMonth > 12) {
    return {
      ...ctx,
      state: {
        ...ctx.state,
        currentYear: ctx.state.currentYear + 1,
        currentMonth: 1,
      },
    }
  }
  return {
    ...ctx,
    state: {
      ...ctx.state,
      currentMonth: newMonth,
    },
  }
}
