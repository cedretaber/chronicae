import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import {
  applySeekDiplomaticSupportMut,
  buildDiplomaticSupportDeclaredEventInput,
} from './diplomaticSupportEvents'
import { selectDiplomaticTaskKind } from '../selectors/taskSelectors'
import { defaultConfig } from '../config/defaultConfig'
import type { CreateSimEventInput } from './context'
import type { WorldState } from '../types/world'
import type { DiplomaticPlayId, PolityId } from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// v0.43 Phase 5: seek_diplomatic_support の効果適用・event 構築・task 選定。

const PLAY_ID = 'dp-1' as DiplomaticPlayId
const INITIATOR = 'c-init' as PolityId
const TARGET = 'c-target' as PolityId

function makePlay(overrides: Partial<DiplomaticPlay> = {}): DiplomaticPlay {
  return {
    id: PLAY_ID,
    kind: 'contract_tax_revision',
    initiator: { kind: 'polity', id: INITIATOR },
    target: { kind: 'polity', id: TARGET },
    status: 'active',
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
    ...overrides,
  }
}

// candidate c-rich は treasury 1000 → treasuryScore 100 × weight 0.10 = total 10。
// threshold を 5 に下げて到達させる (素の threshold 25 は proximity 等が必要)。
function makeStateWithCandidate(): WorldState {
  let s = makeEmptyV016State()
  s = withPolity(s, INITIATOR, {})
  s = withPolity(s, TARGET, {})
  s = withPolity(s, 'c-rich' as PolityId, { treasury: 1000 })
  s.diplomaticPlays[PLAY_ID] = makePlay()
  return s
}

const lowThresholdConfig = { ...defaultConfig, diplomaticSupportJoinScoreThreshold: 5 }

describe('applySeekDiplomaticSupportMut (§7.6)', () => {
  it('success + joinScore >= threshold: adds supporter and emits event', () => {
    const ws = makeStateWithCandidate()
    const events: CreateSimEventInput[] = []
    applySeekDiplomaticSupportMut(ws, lowThresholdConfig, PLAY_ID, 'initiator', 'success', (e) =>
      events.push(e),
    )
    const play = ws.diplomaticPlays[PLAY_ID]!
    expect(play.initiatorSupporters).toHaveLength(1)
    expect(play.initiatorSupporters[0]?.actor).toEqual({ kind: 'polity', id: 'c-rich' })
    expect(play.initiatorSupporters[0]?.joinedWeek).toBe(ws.absoluteWeek)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('DIPLOMATIC_SUPPORT_DECLARED')
  })

  it('success but joinScore < threshold: no supporter, no event', () => {
    const ws = makeStateWithCandidate()
    const events: CreateSimEventInput[] = []
    // default threshold 25 > total 10
    applySeekDiplomaticSupportMut(ws, defaultConfig, PLAY_ID, 'initiator', 'success', (e) =>
      events.push(e),
    )
    expect(ws.diplomaticPlays[PLAY_ID]!.initiatorSupporters).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('failure / partial: no supporter, no event', () => {
    for (const outcome of ['failure', 'partial'] as const) {
      const ws = makeStateWithCandidate()
      const events: CreateSimEventInput[] = []
      applySeekDiplomaticSupportMut(ws, lowThresholdConfig, PLAY_ID, 'initiator', outcome, (e) =>
        events.push(e),
      )
      expect(ws.diplomaticPlays[PLAY_ID]!.initiatorSupporters).toHaveLength(0)
      expect(events).toHaveLength(0)
    }
  })

  it('no candidate: no supporter, no event (DEBUG only)', () => {
    let s = makeEmptyV016State()
    s = withPolity(s, INITIATOR, {})
    s = withPolity(s, TARGET, {})
    s.diplomaticPlays[PLAY_ID] = makePlay()
    const events: CreateSimEventInput[] = []
    applySeekDiplomaticSupportMut(s, lowThresholdConfig, PLAY_ID, 'initiator', 'success', (e) =>
      events.push(e),
    )
    expect(s.diplomaticPlays[PLAY_ID].initiatorSupporters).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})

describe('buildDiplomaticSupportDeclaredEventInput (§17)', () => {
  it('builds params matching the i18n placeholders exactly (ja/en)', () => {
    const ws = makeStateWithCandidate()
    const input = buildDiplomaticSupportDeclaredEventInput(
      ws,
      ws.diplomaticPlays[PLAY_ID]!,
      'initiator',
      'c-rich' as PolityId,
    )
    expect(input).toBeDefined()
    expect(input!.messageKey).toBe('diplomatic_play.support_declared')
    const paramNames = Object.keys(input!.messageParams).sort()

    // yaml 側の placeholder を実ファイルから抽出して厳密一致を確認 (drift 防止)
    for (const locale of ['ja', 'en']) {
      const yaml = readFileSync(
        resolve(__dirname, `../../i18n/locales/${locale}/events.yaml`),
        'utf8',
      )
      const line = yaml.split('\n').find((l) => l.trimStart().startsWith('support_declared:'))
      expect(line).toBeDefined()
      const placeholders = [...line!.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
      expect(paramNames).toEqual(placeholders)
    }
  })

  it('marks supporter / supported / opponent entity roles', () => {
    const ws = makeStateWithCandidate()
    const input = buildDiplomaticSupportDeclaredEventInput(
      ws,
      ws.diplomaticPlays[PLAY_ID]!,
      'target',
      'c-rich' as PolityId,
    )
    const roles = (input!.entityRefs ?? []).map((r) => r.role)
    expect(roles).toEqual(['supporter', 'supported', 'opponent'])
    // target side 支援 → supported は play.target
    const supported = (input!.entityRefs ?? []).find((r) => r.role === 'supported')
    expect(supported?.id).toBe(TARGET)
  })
})

describe('selectDiplomaticTaskKind と seek_diplomatic_support (§7.5)', () => {
  it('returns seek before deficit branch when tension >= escalation*0.6', () => {
    const ws = makeStateWithCandidate()
    const play = makePlay({ tension: defaultConfig.diplomaticPlayEscalationThreshold * 0.6 })
    expect(selectDiplomaticTaskKind(ws, defaultConfig, play, 'initiator')).toBe(
      'seek_diplomatic_support',
    )
  })

  it('falls back to deficit branch when tension is low (prep < 30)', () => {
    const ws = makeStateWithCandidate()
    const play = makePlay({ tension: 0 })
    expect(selectDiplomaticTaskKind(ws, defaultConfig, play, 'initiator')).toBe('prepare_argument')
  })

  it('revolt rebel (initiator) side seeks unconditionally; suppressor (target) side never', () => {
    const ws = makeStateWithCandidate()
    const play = makePlay({ kind: 'revolt_negotiation', tension: 0 })
    expect(selectDiplomaticTaskKind(ws, defaultConfig, play, 'initiator')).toBe(
      'seek_diplomatic_support',
    )
    expect(selectDiplomaticTaskKind(ws, defaultConfig, play, 'target')).not.toBe(
      'seek_diplomatic_support',
    )
  })

  it('does not seek when supporter cap is reached', () => {
    const ws = makeStateWithCandidate()
    const play = makePlay({
      tension: 100,
      initiatorSupporters: [
        { actor: { kind: 'polity', id: 'c-s1' as PolityId }, joinedWeek: 0, commitment: 50 },
        { actor: { kind: 'polity', id: 'c-s2' as PolityId }, joinedWeek: 0, commitment: 50 },
      ],
    })
    expect(selectDiplomaticTaskKind(ws, defaultConfig, play, 'initiator')).not.toBe(
      'seek_diplomatic_support',
    )
  })

  it('does not seek when there is no candidate', () => {
    let s = makeEmptyV016State()
    s = withPolity(s, INITIATOR, {})
    s = withPolity(s, TARGET, {})
    const play = makePlay({ tension: 100 })
    expect(selectDiplomaticTaskKind(s, defaultConfig, play, 'initiator')).not.toBe(
      'seek_diplomatic_support',
    )
  })

  it('does not seek when play is escalated (status gate)', () => {
    const ws = makeStateWithCandidate()
    const play = makePlay({ status: 'escalated', tension: 100 })
    expect(selectDiplomaticTaskKind(ws, defaultConfig, play, 'initiator')).not.toBe(
      'seek_diplomatic_support',
    )
  })
})
