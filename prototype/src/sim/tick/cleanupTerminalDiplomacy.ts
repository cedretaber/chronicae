import type { TickContext } from './context'
import type { ActorIntentId, DiplomaticPlayId } from '../types/ids'
import type { ActorIntent } from '../types/actorIntent'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { WorldState } from '../types/world'
import {
  TERMINAL_ACTOR_INTENT_STATUSES,
  type TerminalActorIntentStatus,
} from '../types/actorIntent'
import {
  TERMINAL_DIPLOMATIC_PLAY_STATUSES,
  type TerminalDiplomaticPlayStatus,
} from '../types/diplomaticPlay'

// v0.18 Stage A §5.7 / §6.6
// tick 末で terminal status の ActorIntent / DiplomaticPlay を Record から完全削除する phase。
// v0.17.3 で発覚した OfficeAssignment / FactionMembership の inactive 累積 perf 問題を
// 再発させないため、最初から「履歴は event ログに残し、Entity としては保持しない」設計とする。
//
// v0.18 Stage D 追加: actor が inactive になった Intent / Play は terminal 化したうえで削除する。
//   ConflictResolution や polityOwnerConsistencySystem が Polity を deactivate した直後の
//   tick で integrityCheck §20 を通すため、cleanup phase で同時に処理する。

const TERMINAL_INTENT_SET = new Set<TerminalActorIntentStatus>(TERMINAL_ACTOR_INTENT_STATUSES)
const TERMINAL_PLAY_SET = new Set<TerminalDiplomaticPlayStatus>(TERMINAL_DIPLOMATIC_PLAY_STATUSES)

function isActorActive(state: WorldState, actor: PoliticalActorRef): boolean {
  if (actor.kind === 'polity') {
    return state.polities[actor.id]?.active === true
  }
  return state.houses[actor.id]?.active === true
}

export function runCleanupTerminalDiplomacy(ctx: TickContext): TickContext {
  const intents = ctx.state.actorIntents
  const plays = ctx.state.diplomaticPlays

  let nextIntents: Record<ActorIntentId, ActorIntent> | undefined

  for (const idStr of Object.keys(intents)) {
    const intent = intents[idStr as ActorIntentId]
    if (!intent) continue
    // actor / targetActor が inactive なら expired として削除
    if (
      !isActorActive(ctx.state, intent.actor) ||
      (intent.targetActor && !isActorActive(ctx.state, intent.targetActor))
    ) {
      if (!nextIntents) nextIntents = { ...intents }
      delete nextIntents[idStr as ActorIntentId]
      continue
    }
    if (TERMINAL_INTENT_SET.has(intent.status as TerminalActorIntentStatus)) {
      if (!nextIntents) nextIntents = { ...intents }
      delete nextIntents[idStr as ActorIntentId]
    }
  }

  let nextPlays: Record<DiplomaticPlayId, DiplomaticPlay> | undefined
  for (const idStr of Object.keys(plays)) {
    const play = plays[idStr as DiplomaticPlayId]
    if (!play) continue
    // initiator / target が inactive なら cancelled として削除
    if (!isActorActive(ctx.state, play.initiator) || !isActorActive(ctx.state, play.target)) {
      if (!nextPlays) nextPlays = { ...plays }
      delete nextPlays[idStr as DiplomaticPlayId]
      continue
    }
    if (TERMINAL_PLAY_SET.has(play.status as TerminalDiplomaticPlayStatus)) {
      if (!nextPlays) nextPlays = { ...plays }
      delete nextPlays[idStr as DiplomaticPlayId]
    }
  }

  if (!nextIntents && !nextPlays) return ctx

  return {
    ...ctx,
    state: {
      ...ctx.state,
      actorIntents: nextIntents ?? intents,
      diplomaticPlays: nextPlays ?? plays,
    },
  }
}
