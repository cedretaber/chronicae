import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import type { SimEvent } from '../types/event'
import type { EventId, PersonId, HouseId, PolityId } from '../types/ids'

export type TickInput = {
  state: WorldState
  rng: RngState
  config: SimulationConfig
}

export type TickResult = {
  state: WorldState
  rng: RngState
  events: SimEvent[]
  systemTimings?: Record<string, number>
}

export type DeathRoleInfo = {
  readonly wasHouseLeader: boolean
  readonly wasPolityLeader: boolean
}

export type TickContext = {
  readonly state: WorldState
  readonly rng: RngState
  readonly config: SimulationConfig
  readonly events: readonly SimEvent[]
  readonly nextEventIndex: number
  readonly nextPersonIndex: number
  readonly nextHouseIndex: number
  readonly nextPolityIndex: number
  readonly deathsThisTick: readonly PersonId[]
  readonly deathRolesThisTick: Readonly<Record<string, DeathRoleInfo>>
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
  let maxHouseIndex = -1
  for (const houseId of Object.keys(input.state.houses).sort()) {
    if (!houseId.startsWith('dh-')) continue
    const n = parseInt(houseId.slice(3), 10)
    if (!isNaN(n) && n > maxHouseIndex) maxHouseIndex = n
  }
  let maxPolityIndex = -1
  for (const polityId of Object.keys(input.state.polities).sort()) {
    if (!polityId.startsWith('dp-')) continue
    const n = parseInt(polityId.slice(3), 10)
    if (!isNaN(n) && n > maxPolityIndex) maxPolityIndex = n
  }
  return {
    state: input.state,
    rng: input.rng,
    config: input.config,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: maxPersonIndex + 1,
    nextHouseIndex: maxHouseIndex + 1,
    nextPolityIndex: maxPolityIndex + 1,
    deathsThisTick: [],
    deathRolesThisTick: {},
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
  const id = `e-${ctx.state.absoluteWeek}-${ctx.nextEventIndex}` as EventId
  return { id, ctx: { ...ctx, nextEventIndex: ctx.nextEventIndex + 1 } }
}

export function makePersonId(ctx: TickContext): { id: PersonId; ctx: TickContext } {
  const id = `pe-${ctx.nextPersonIndex}` as PersonId
  return { id, ctx: { ...ctx, nextPersonIndex: ctx.nextPersonIndex + 1 } }
}

export function makeHouseId(ctx: TickContext): { id: HouseId; ctx: TickContext } {
  const id = `dh-${ctx.nextHouseIndex}` as HouseId
  return { id, ctx: { ...ctx, nextHouseIndex: ctx.nextHouseIndex + 1 } }
}

export function makePolityId(ctx: TickContext): { id: PolityId; ctx: TickContext } {
  const id = `dp-${ctx.nextPolityIndex}` as PolityId
  return { id, ctx: { ...ctx, nextPolityIndex: ctx.nextPolityIndex + 1 } }
}
