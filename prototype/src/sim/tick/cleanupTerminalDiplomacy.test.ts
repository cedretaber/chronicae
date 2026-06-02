import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { createTickContext } from './context'
import { runCleanupTerminalDiplomacy } from './cleanupTerminalDiplomacy'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { WorldState } from '../types/world'
import type { DiplomaticPlayId, DiplomaticOfferId, PolityId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticOffer } from '../types/diplomaticPlay'

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
      kind: 'status_quo',
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
    offerHistoryIds: [],
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

  it('cascade-deletes offers for terminal plays', () => {
    let s = makeStateWithActors()
    const play = makePlay('dp-1', 'settled')
    const offer1: DiplomaticOffer = {
      id: 'do-1' as DiplomaticOfferId,
      playId: 'dp-1' as DiplomaticPlayId,
      proposedBy: { kind: 'polity', id: 'c-1' as PolityId },
      demands: [{ kind: 'status_quo' }],
      status: 'accepted',
      createdWeek: 100,
      reasonIds: [],
    }
    const offer2: DiplomaticOffer = {
      id: 'do-2' as DiplomaticOfferId,
      playId: 'dp-1' as DiplomaticPlayId,
      proposedBy: { kind: 'polity', id: 'c-2' as PolityId },
      demands: [{ kind: 'status_quo' }],
      status: 'withdrawn',
      createdWeek: 101,
      reasonIds: [],
    }
    play.offerHistoryIds = ['do-1' as DiplomaticOfferId, 'do-2' as DiplomaticOfferId]
    play.currentOfferId = 'do-2' as DiplomaticOfferId
    s = {
      ...s,
      diplomaticPlays: { [play.id]: play },
      diplomaticOffers: {
        [offer1.id]: offer1,
        [offer2.id]: offer2,
      },
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(Object.keys(next.state.diplomaticPlays)).toEqual([])
    expect(Object.keys(next.state.diplomaticOffers)).toEqual([])
  })

  it('preserves offers for active plays', () => {
    let s = makeStateWithActors()
    const activePlay = makePlay('dp-1', 'active')
    const offer: DiplomaticOffer = {
      id: 'do-1' as DiplomaticOfferId,
      playId: 'dp-1' as DiplomaticPlayId,
      proposedBy: { kind: 'polity', id: 'c-1' as PolityId },
      demands: [{ kind: 'status_quo' }],
      status: 'pending',
      createdWeek: 100,
      reasonIds: [],
    }
    activePlay.offerHistoryIds = ['do-1' as DiplomaticOfferId]
    activePlay.currentOfferId = 'do-1' as DiplomaticOfferId
    s = {
      ...s,
      diplomaticPlays: { [activePlay.id]: activePlay },
      diplomaticOffers: { [offer.id]: offer },
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(next).toBe(ctx)
    expect(Object.keys(next.state.diplomaticOffers)).toEqual(['do-1'])
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
