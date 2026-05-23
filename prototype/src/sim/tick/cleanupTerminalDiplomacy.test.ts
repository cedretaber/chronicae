import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { createTickContext } from './context'
import { runCleanupTerminalDiplomacy } from './cleanupTerminalDiplomacy'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { WorldState } from '../types/world'
import type { ActorIntentId, DiplomaticPlayId, PolityId, ProvinceId } from '../types/ids'
import type { ActorIntent } from '../types/actorIntent'
import type { DiplomaticPlay } from '../types/diplomaticPlay'

// v0.18 Stage D 追加: cleanup は inactive actor 参照 Play / Intent も削除する。
// テストでは fixture で active な c-1 / c-2 polity を用意しておく。
function makeStateWithActors(): WorldState {
  let s = makeEmptyV016State()
  s = withPolity(s, 'c-1' as PolityId, { rank: 2, treasury: 100 })
  s = withPolity(s, 'c-2' as PolityId, { rank: 2, treasury: 100 })
  return s
}

function makeCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('cleanup-test'), config: defaultConfig })
}

function makeIntent(id: string, status: ActorIntent['status']): ActorIntent {
  return {
    id: id as ActorIntentId,
    actor: { kind: 'polity', id: 'c-1' as PolityId },
    kind: 'acquire_land',
    priority: 1,
    rationale: 'expand_territory',
    status,
    createdWeek: 1000 * 48 + 1 - 1,
    expiresWeek: 1001 * 48 + 1 - 1,
  }
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
  it('returns state unchanged when both records are empty', () => {
    const s = makeEmptyV016State()
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(next).toBe(ctx)
  })

  it('keeps active Intent and Play untouched', () => {
    let s = makeStateWithActors()
    const intent = makeIntent('ai-1', 'active')
    const play = makePlay('dp-1', 'active')
    s = {
      ...s,
      actorIntents: { [intent.id]: intent },
      diplomaticPlays: { [play.id]: play },
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(next).toBe(ctx) // no changes => same reference
  })

  it('removes terminal Intent (converted / expired / cancelled)', () => {
    let s = makeStateWithActors()
    const active = makeIntent('ai-active', 'active')
    const converted = makeIntent('ai-converted', 'converted')
    const expired = makeIntent('ai-expired', 'expired')
    const cancelled = makeIntent('ai-cancelled', 'cancelled')
    s = {
      ...s,
      actorIntents: {
        [active.id]: active,
        [converted.id]: converted,
        [expired.id]: expired,
        [cancelled.id]: cancelled,
      },
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(Object.keys(next.state.actorIntents)).toEqual(['ai-active'])
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

  it('does not roll back nextActorIntentId / nextDiplomaticPlayId on deletion', () => {
    let s = makeStateWithActors()
    s = {
      ...s,
      actorIntents: { 'ai-1': makeIntent('ai-1', 'expired') } as Record<ActorIntentId, ActorIntent>,
      diplomaticPlays: { 'dp-1': makePlay('dp-1', 'settled') } as Record<
        DiplomaticPlayId,
        DiplomaticPlay
      >,
      nextActorIntentId: 5,
      nextDiplomaticPlayId: 3,
    }
    const ctx = makeCtx(s)
    const next = runCleanupTerminalDiplomacy(ctx)
    expect(next.state.nextActorIntentId).toBe(5)
    expect(next.state.nextDiplomaticPlayId).toBe(3)
  })
})
