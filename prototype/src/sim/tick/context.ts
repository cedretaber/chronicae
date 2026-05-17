import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { SimulationConfig } from '../config/defaultConfig'
import type { SimEvent } from '../types/event'
import type { EventId, PersonId, HouseId, CountryId } from '../types/ids'

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

export type DeathRoleInfo = {
  readonly wasHouseLeader: boolean
  readonly wasCountryLeader: boolean
}

export type TickContext = {
  readonly state: WorldState
  readonly rng: RngState
  readonly config: SimulationConfig
  readonly events: readonly SimEvent[]
  readonly nextEventIndex: number
  readonly nextPersonIndex: number
  readonly nextHouseIndex: number
  readonly nextCountryIndex: number
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
  let maxCountryIndex = -1
  for (const countryId of Object.keys(input.state.countries).sort()) {
    if (!countryId.startsWith('dc-')) continue
    const n = parseInt(countryId.slice(3), 10)
    if (!isNaN(n) && n > maxCountryIndex) maxCountryIndex = n
  }
  return {
    state: input.state,
    rng: input.rng,
    config: input.config,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: maxPersonIndex + 1,
    nextHouseIndex: maxHouseIndex + 1,
    nextCountryIndex: maxCountryIndex + 1,
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
  const id = `e-${ctx.state.currentYear}-${ctx.state.currentMonth}-${ctx.nextEventIndex}` as EventId
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

export function makeCountryId(ctx: TickContext): { id: CountryId; ctx: TickContext } {
  const id = `dc-${ctx.nextCountryIndex}` as CountryId
  return { id, ctx: { ...ctx, nextCountryIndex: ctx.nextCountryIndex + 1 } }
}
