import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { createTickContext } from './context'
import { runCleanupTerminalDiplomacy } from './cleanupTerminalDiplomacy'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { WorldState } from '../types/world'
import type { DiplomaticPlayId, PolityId, ProvinceId } from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'

function makeStateWithActors(): WorldState {
  let s = makeEmptyV016State()
  s = withPolity(s, 'c-1' as PolityId, { rank: 2, treasury: 100 })
  s = withPolity(s, 'c-2' as PolityId, { rank: 2, treasury: 100 })
  return s
}

function makeCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('cleanup-test'), config: defaultConfig })
}

function makePlay(id: string, status: DiplomaticPlay['status']): DiplomaticPlay {
  return {
    id: id as DiplomaticPlayId,
    kind: 'revolt_negotiation',
    initiator: { kind: 'polity', id: 'c-1' as PolityId },
    target: { kind: 'polity', id: 'c-2' as PolityId },
    primaryDemand: {
      kind: 'revolt_concession',
      provinceId: 'pr-0' as ProvinceId,
      popClass: 'peasants' as const,
      concessionLevel: 'minor',
    },
    status,
    startedWeek: 1000 * 48 + 1 - 1,
    deadlineWeek: 1000 * 48 + 7 - 1,
    progress: 0,
    tension: 0,
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
  }
}

describe('cleanupTerminalDiplomacy', () => {
  it('returns state unchanged when records are empty', () => {
    const s = makeEmptyV016State()
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(next).toBe(ctx)
  })

  it('keeps active Play untouched', () => {
    let s = makeStateWithActors()
    const play = makePlay('dp-1', 'active')
    s = {
      ...s,
      diplomaticPlays: { [play.id]: play },
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(next).toBe(ctx)
  })

  it('removes terminal Play (settled / failed / resolved_by_conflict / cancelled)', () => {
    let s = makeStateWithActors()
    const active = makePlay('dp-active', 'active')
    const settled = makePlay('dp-settled', 'settled')
    const failed = makePlay('dp-failed', 'failed')
    const resolved = makePlay('dp-resolved', 'resolved_by_conflict')
    const cancelled = makePlay('dp-cancelled', 'cancelled')
    s = {
      ...s,
      diplomaticPlays: {
        [active.id]: active,
        [settled.id]: settled,
        [failed.id]: failed,
        [resolved.id]: resolved,
        [cancelled.id]: cancelled,
      },
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(Object.keys(next.state.diplomaticPlays)).toEqual(['dp-active'])
  })

  it('does not roll back nextDiplomaticPlayId on deletion', () => {
    let s = makeStateWithActors()
    s = {
      ...s,
      diplomaticPlays: { 'dp-1': makePlay('dp-1', 'settled') } as Record<
        DiplomaticPlayId,
        DiplomaticPlay
      >,
      nextDiplomaticPlayId: 3,
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(next.state.nextDiplomaticPlayId).toBe(3)
  })
})
