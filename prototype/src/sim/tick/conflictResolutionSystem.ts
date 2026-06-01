import type { TickContext } from './context'

// v0.39 C-6: revolt_negotiation は warCreationSystem 経由で War 化されるため、
// この system は不要になった。後方互換のため export を維持するが本体は no-op。
export function runConflictResolutionSystem(ctx: TickContext): TickContext {
  return ctx
}
