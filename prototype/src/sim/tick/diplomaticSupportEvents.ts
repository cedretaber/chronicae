// v0.43 §7.6 / §17: seek_diplomatic_support Task の効果適用と
// DIPLOMATIC_SUPPORT_DECLARED event の構築。
//
// taskSystem の diplomatic_play 分岐 (mutable draft + emitEvent callback) から呼ぶ。
// event input の構築を export しておき、placeholder 一致の unit test を直叩きで行えるようにする
// (helper 経由 emit は静的 coverage 網にかかりにくい — v0.42 の教訓)。

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { DiplomaticPlayId, PolityId } from '../types/ids'
import type { DiplomaticPlay, DiplomaticPlaySideKey } from '../types/diplomaticPlay'
import type { TaskOutcomeKind } from '../types/task'
import type { CreateSimEventInput } from './context'
import { nameParam, entityRef } from '../types/event'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import {
  selectBestSupportCandidate,
  type JoinScoreBreakdown,
} from '../selectors/diplomaticSupportSelectors'
import { addDiplomaticPlaySupporterMut } from '../mutations/diplomaticPlaySupporterMutations'
import { createLogger } from '../debug/logger'
import { clamp } from '../utils/math'

// DIPLOMATIC_SUPPORT_DECLARED の event input を構築する (純関数)。
export function buildDiplomaticSupportDeclaredEventInput(
  ws: WorldState,
  play: DiplomaticPlay,
  side: DiplomaticPlaySideKey,
  supporterPolityId: PolityId,
): CreateSimEventInput | undefined {
  const supportedPrimary = side === 'initiator' ? play.initiator : play.target
  const enemyPrimary = side === 'initiator' ? play.target : play.initiator
  if (supportedPrimary.kind !== 'polity' || enemyPrimary.kind !== 'polity') return undefined

  const supporterRef = getPolityNameRefForEmit(ws, supporterPolityId)
  const supportedRef = getPolityNameRefForEmit(ws, supportedPrimary.id)
  const enemyRef = getPolityNameRefForEmit(ws, enemyPrimary.id)

  return {
    type: 'DIPLOMATIC_SUPPORT_DECLARED',
    importance: 'normal',
    messageKey: 'diplomatic_play.support_declared',
    messageParams: {
      supporter: nameParam(supporterRef.category, supporterRef.nameKey),
      supported: nameParam(supportedRef.category, supportedRef.nameKey),
      opponent: nameParam(enemyRef.category, enemyRef.nameKey),
    },
    entityRefs: [
      entityRef('polity', supporterPolityId, 'supporter', supporterRef.nameKey),
      entityRef('polity', supportedPrimary.id, 'supported', supportedRef.nameKey),
      entityRef('polity', enemyPrimary.id, 'opponent', enemyRef.nameKey),
    ],
  }
}

// §7.6: seek_diplomatic_support 完了時の効果。
//   success → 最良候補の joinScore が閾値以上なら supporter 追加 + event emit。
//   partial / failure → 何もしない (v0.43 では微小効果も入れない — 最小実装)。
//   success だが threshold 未満 / 候補なし → DEBUG log のみ (§7.6)。
export function applySeekDiplomaticSupportMut(
  ws: WorldState,
  config: SimulationConfig,
  playId: DiplomaticPlayId,
  side: DiplomaticPlaySideKey,
  outcome: TaskOutcomeKind,
  emitEvent: (input: CreateSimEventInput) => void,
): void {
  const log = createLogger(config.debug)
  if (outcome !== 'success') {
    log.log('SUPPORT_RECRUIT', { playId, side, outcome, result: 'task_not_success' })
    return
  }
  const play = ws.diplomaticPlays[playId]
  if (!play || play.status !== 'active') return

  const best = selectBestSupportCandidate(ws, config, play, side)
  if (!best) {
    log.log('SUPPORT_RECRUIT', { playId, side, outcome, result: 'no_candidate' })
    return
  }
  if (best.score.total < config.diplomaticSupportJoinScoreThreshold) {
    log.log('SUPPORT_RECRUIT', {
      playId,
      side,
      outcome,
      result: 'below_threshold',
      candidate: best.polityId,
      ...flattenScore(best.score),
      threshold: config.diplomaticSupportJoinScoreThreshold,
    })
    return
  }

  const result = addDiplomaticPlaySupporterMut(ws, config, playId, side, {
    actor: { kind: 'polity', id: best.polityId },
    joinedWeek: ws.absoluteWeek,
    // commitment は joinScore 由来 (§5.1: 固定値または joinScore 由来でよい)
    commitment: clamp(best.score.total, 0, 100),
  })
  log.log('SUPPORT_RECRUIT', {
    playId,
    side,
    outcome,
    result,
    candidate: best.polityId,
    ...flattenScore(best.score),
  })
  if (result !== 'added') return

  const eventInput = buildDiplomaticSupportDeclaredEventInput(ws, play, side, best.polityId)
  if (eventInput) emitEvent(eventInput)
}

function flattenScore(score: JoinScoreBreakdown): Record<string, number> {
  return {
    score: Math.round(score.total * 100) / 100,
    proximity: score.proximity,
    military: Math.round(score.militarySparePower * 100) / 100,
    treasury: Math.round(score.treasury * 100) / 100,
    threat: Math.round(score.threatContainment * 100) / 100,
    lastWar: Math.round(score.lastWarPenalty * 100) / 100,
    persuasion: Math.round(score.persuasion * 100) / 100,
    rebelBacking: Math.round(score.rebelBacking * 100) / 100,
  }
}
