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

export function mapResult<T, U>(result: SimResult<T>, fn: (value: T) => U): SimResult<U> {
  if (!result.ok) return result
  return ok(fn(result.value))
}

export function andThen<T, U>(result: SimResult<T>, fn: (value: T) => SimResult<U>): SimResult<U> {
  if (!result.ok) return result
  return fn(result.value)
}
