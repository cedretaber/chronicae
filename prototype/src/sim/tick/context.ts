import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import type { SimEvent } from '../types/event'
import type { EventId, PersonId } from '../types/ids'

export type TickInput = {
  state: WorldState
  rng: RngState
  config: SimulationConfig
}

export type TickResult = {
  state: WorldState
  rng: RngState
  events: SimEvent[]
}

export type TickContext = {
  readonly state: WorldState
  readonly rng: RngState
  readonly config: SimulationConfig
  readonly events: readonly SimEvent[]
  readonly nextEventIndex: number
  readonly nextPersonIndex: number
}

export function createTickContext(input: TickInput): TickContext {
  let maxPersonIndex = -1
  for (const personId of Object.keys(input.state.persons).sort()) {
    const parts = personId.split('-')
    const last = parts[parts.length - 1]
    if (last !== undefined) {
      const n = parseInt(last, 10)
      if (!isNaN(n) && n > maxPersonIndex) maxPersonIndex = n
    }
  }
  return {
    state: input.state,
    rng: input.rng,
    config: input.config,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: maxPersonIndex + 1,
  }
}

export function toResult(ctx: TickContext): TickResult {
  return {
    state: ctx.state,
    rng: ctx.rng,
    events: [...ctx.events],
  }
}

export function makeEventId(ctx: TickContext): { id: EventId; ctx: TickContext } {
  const id = `e-${ctx.state.currentYear}-${ctx.state.currentMonth}-${ctx.nextEventIndex}` as EventId
  return { id, ctx: { ...ctx, nextEventIndex: ctx.nextEventIndex + 1 } }
}

export function makePersonId(ctx: TickContext): { id: PersonId; ctx: TickContext } {
  const id = `pe-${ctx.nextPersonIndex}` as PersonId
  return { id, ctx: { ...ctx, nextPersonIndex: ctx.nextPersonIndex + 1 } }
}
