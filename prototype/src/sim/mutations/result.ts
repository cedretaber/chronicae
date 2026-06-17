import type { SimError } from './errors'
import type { WorldState } from '../types/world'
import type { TickContext } from '../tick/context'

export type SimResult<T> = { ok: true; value: T } | { ok: false; error: SimError }

export type StateResult<T = WorldState> = SimResult<T>

export type CtxResult<T = void> = SimResult<{ ctx: TickContext; value: T }>

export function ok<T>(value: T): SimResult<T> {
  return { ok: true, value }
}

export function err<T>(error: SimError): SimResult<T> {
  return { ok: false, error }
}
