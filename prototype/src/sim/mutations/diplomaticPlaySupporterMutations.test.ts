import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { addDiplomaticPlaySupporterMut } from './diplomaticPlaySupporterMutations'
import { defaultConfig } from '../config/defaultConfig'
import type { WorldState } from '../types/world'
import type { DiplomaticPlayId, PolityId, HouseId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticPlaySupporter } from '../types/diplomaticPlay'

// v0.43 §6: addDiplomaticPlaySupporterMut の検査網羅テスト。

const PLAY_ID = 'dp-1' as DiplomaticPlayId

function makeState(): WorldState {
  let s = makeEmptyV016State()
  s = withPolity(s, 'c-1' as PolityId, { rank: 2, treasury: 100 })
  s = withPolity(s, 'c-2' as PolityId, { rank: 2, treasury: 100 })
  s = withPolity(s, 'c-3' as PolityId, { rank: 2, treasury: 100 })
  s = withPolity(s, 'c-4' as PolityId, { rank: 2, treasury: 100 })
  s = withPolity(s, 'c-5' as PolityId, { rank: 2, treasury: 100 })
  s.diplomaticPlays[PLAY_ID] = makePlay('active')
  return s
}

function makePlay(status: DiplomaticPlay['status']): DiplomaticPlay {
  return {
    id: PLAY_ID,
    kind: 'revolt_negotiation',
    initiator: { kind: 'polity', id: 'c-1' as PolityId },
    target: { kind: 'polity', id: 'c-2' as PolityId },
    primaryDemand: { kind: 'status_quo' },
    status,
    startedWeek: 0,
    deadlineWeek: 48,
    progress: 0,
    tension: 0,
    initiatorPreparation: 0,
    initiatorLeverage: 0,
    initiatorCommitment: 0,
    targetPreparation: 0,
    targetLeverage: 0,
    targetCommitment: 0,
    initiatorSupporters: [],
    targetSupporters: [],
    initiatorActiveTaskIds: [],
    targetActiveTaskIds: [],
    offerHistoryIds: [],
  }
}

function makeSupporter(polityId: string): DiplomaticPlaySupporter {
  return {
    actor: { kind: 'polity', id: polityId as PolityId },
    joinedWeek: 10,
    commitment: 50,
  }
}

describe('addDiplomaticPlaySupporterMut', () => {
  it('adds a valid supporter to the initiator side', () => {
    const ws = makeState()
    const result = addDiplomaticPlaySupporterMut(
      ws,
      defaultConfig,
      PLAY_ID,
      'initiator',
      makeSupporter('c-3'),
    )
    expect(result).toBe('added')
    const play = ws.diplomaticPlays[PLAY_ID]!
    expect(play.initiatorSupporters).toHaveLength(1)
    expect(play.initiatorSupporters[0]?.actor).toEqual({ kind: 'polity', id: 'c-3' })
    expect(play.targetSupporters).toHaveLength(0)
  })

  it('adds a valid supporter to the target side', () => {
    const ws = makeState()
    const result = addDiplomaticPlaySupporterMut(
      ws,
      defaultConfig,
      PLAY_ID,
      'target',
      makeSupporter('c-3'),
    )
    expect(result).toBe('added')
    expect(ws.diplomaticPlays[PLAY_ID]!.targetSupporters).toHaveLength(1)
  })

  it('rejects when the play does not exist', () => {
    const ws = makeState()
    const result = addDiplomaticPlaySupporterMut(
      ws,
      defaultConfig,
      'dp-missing' as DiplomaticPlayId,
      'initiator',
      makeSupporter('c-3'),
    )
    expect(result).toBe('play_not_found')
  })

  it('rejects when the play is not active (escalated)', () => {
    const ws = makeState()
    ws.diplomaticPlays[PLAY_ID] = makePlay('escalated')
    const result = addDiplomaticPlaySupporterMut(
      ws,
      defaultConfig,
      PLAY_ID,
      'initiator',
      makeSupporter('c-3'),
    )
    expect(result).toBe('not_active')
  })

  it('rejects a non-polity actor', () => {
    const ws = makeState()
    const supporter: DiplomaticPlaySupporter = {
      actor: { kind: 'house', id: 'h-1' as HouseId },
      joinedWeek: 10,
      commitment: 50,
    }
    expect(addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'initiator', supporter)).toBe(
      'non_polity_actor',
    )
  })

  it('rejects an inactive polity', () => {
    const ws = makeState()
    ws.polities['c-3' as PolityId] = { ...ws.polities['c-3' as PolityId]!, active: false }
    expect(
      addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'initiator', makeSupporter('c-3')),
    ).toBe('inactive_polity')
  })

  it('rejects the primary initiator / target as supporter', () => {
    const ws = makeState()
    expect(
      addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'initiator', makeSupporter('c-1')),
    ).toBe('primary_actor')
    expect(
      addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'target', makeSupporter('c-2')),
    ).toBe('primary_actor')
  })

  it('rejects a duplicate supporter on the same side', () => {
    const ws = makeState()
    expect(
      addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'initiator', makeSupporter('c-3')),
    ).toBe('added')
    expect(
      addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'initiator', makeSupporter('c-3')),
    ).toBe('duplicate')
  })

  it('rejects a supporter already on the opposite side', () => {
    const ws = makeState()
    expect(
      addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'initiator', makeSupporter('c-3')),
    ).toBe('added')
    expect(
      addDiplomaticPlaySupporterMut(ws, defaultConfig, PLAY_ID, 'target', makeSupporter('c-3')),
    ).toBe('opposite_side')
  })

  it('rejects when the side reached maxDiplomaticSupportersPerSide', () => {
    const ws = makeState()
    const config = { ...defaultConfig, maxDiplomaticSupportersPerSide: 1 }
    expect(
      addDiplomaticPlaySupporterMut(ws, config, PLAY_ID, 'initiator', makeSupporter('c-3')),
    ).toBe('added')
    expect(
      addDiplomaticPlaySupporterMut(ws, config, PLAY_ID, 'initiator', makeSupporter('c-4')),
    ).toBe('max_supporters_reached')
    // 反対 side は別カウント
    expect(addDiplomaticPlaySupporterMut(ws, config, PLAY_ID, 'target', makeSupporter('c-4'))).toBe(
      'added',
    )
  })
})
