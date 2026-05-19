import type { TickContext } from './context'
import { makeEventId } from './context'
import type { ActorIntentId } from '../types/ids'
import { createDiplomaticPlayId } from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import type { PoliticalActorRef } from '../types/actor'
import type { SimEvent } from '../types/event'

// v0.18 Stage C §9: IntentToDiplomaticPlaySystem
// active な ActorIntent を DiplomaticPlay に変換する。
// Stage C では sell_land → land_purchase のみ (他 kind は Stage D 以降)。
//
// Play actor mapping:
//   sell_land Intent (actor=seller, targetActor=buyer)
//     → land_purchase Play (initiator=buyer, target=seller)
//   理由: spec §10.3.2 の acceptanceScore は seller 視点 (target=seller として評価)。
//        Stage D の acquire_land、Stage B の revolt_negotiation とも
//        「initiator が target に何かを要求」のパターンで一貫させる。
//
// 変換後の Intent は status='converted' になり、tick 末の cleanupTerminalDiplomacy で削除される。
// 変換できない Intent は immediate に status='expired' に (spec §9.2)。

export function runIntentToDiplomaticPlaySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // 既存 active Play の重複防止キーを構築 (§9.3)
  // key: `${kind}|${initiatorId}|${targetId}|${targetProvinceId}`
  const existingActivePlayKeys = new Set<string>()
  for (const play of Object.values(currentCtx.state.diplomaticPlays)) {
    if (!play || play.status !== 'active') continue
    const key = playDedupeKey(play)
    if (key) existingActivePlayKeys.add(key)
  }

  for (const intentIdStr of Object.keys(currentCtx.state.actorIntents).sort()) {
    const intent = currentCtx.state.actorIntents[intentIdStr as ActorIntentId]
    if (!intent || intent.status !== 'active') continue

    // Stage C: sell_land のみ変換 (他 kind は Stage D 以降)
    if (intent.kind !== 'sell_land') continue

    if (!intent.targetActor) {
      // sell_land Intent には targetActor 必須 (buyer)
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }
    if (intent.targetProvinceId === undefined) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }
    // Polity actor のみ (Stage C)
    if (intent.actor.kind !== 'polity' || intent.targetActor.kind !== 'polity') {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    // actor / targetActor が依然 active かを確認
    const sellerPolity = currentCtx.state.polities[intent.actor.id]
    const buyerPolity = currentCtx.state.polities[intent.targetActor.id]
    if (!sellerPolity || !sellerPolity.active || !buyerPolity || !buyerPolity.active) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    // 重複 Play チェック
    const initiator: PoliticalActorRef = intent.targetActor // buyer
    const target: PoliticalActorRef = intent.actor // seller
    const dedupeKey = `land_purchase|${initiator.kind}:${initiator.id}|${target.kind}:${target.id}|${intent.targetProvinceId}`
    if (existingActivePlayKeys.has(dedupeKey)) {
      currentCtx = setIntentStatus(currentCtx, intent.id, 'expired')
      continue
    }

    // Play 生成
    const playId = createDiplomaticPlayId(currentCtx.state.nextDiplomaticPlayId)
    const totalStartedMonth = currentCtx.state.currentMonth - 1
    const durationMonths = currentCtx.config.landPurchaseNegotiationDurationMonths
    const deadlineYear =
      currentCtx.state.currentYear + Math.floor((totalStartedMonth + durationMonths) / 12)
    const deadlineMonth = ((totalStartedMonth + durationMonths) % 12) + 1

    const play: DiplomaticPlay = {
      id: playId,
      kind: 'land_purchase',
      initiator,
      target,
      originIntentId: intent.id,
      primaryDemand: {
        kind: 'transfer_land_contract',
        provinceId: intent.targetProvinceId,
        toPolityId: initiator.id,
        beneficiaryActor: initiator,
      },
      counterDemand: {
        kind: 'pay_wealth',
        from: initiator,
        to: target,
        amount: intent.priority, // sell_land Intent では priority = price
      },
      status: 'active',
      startedYear: currentCtx.state.currentYear,
      startedMonth: currentCtx.state.currentMonth,
      deadlineYear,
      deadlineMonth,
      progress: 0,
      tension: 0,
    }

    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        diplomaticPlays: {
          ...currentCtx.state.diplomaticPlays,
          [playId]: play,
        },
        nextDiplomaticPlayId: currentCtx.state.nextDiplomaticPlayId + 1,
      },
    }
    existingActivePlayKeys.add(dedupeKey)

    // Intent.status = 'converted' (tick 末で cleanup)
    currentCtx = setIntentStatus(currentCtx, intent.id, 'converted')

    // ACTOR_INTENT_CONVERTED event
    const { id: convEventId, ctx: ctxConv } = makeEventId(currentCtx)
    const sellerName = ctxConv.state.polities[target.id]?.name ?? String(target.id)
    const buyerName = ctxConv.state.polities[initiator.id]?.name ?? String(initiator.id)
    const provinceName =
      ctxConv.state.provinces[intent.targetProvinceId]?.name ?? intent.targetProvinceId
    const convEv: SimEvent = {
      id: convEventId,
      year: ctxConv.state.currentYear,
      month: ctxConv.state.currentMonth,
      type: 'ACTOR_INTENT_CONVERTED',
      importance: 'normal',
      actorIds: [],
      houseIds: [],
      polityIds: [target.id, initiator.id],
      provinceIds: [intent.targetProvinceId],
      summary: `${sellerName}'s offer to sell ${provinceName} to ${buyerName} has entered negotiations.`,
      reasons: [],
      effects: [],
    }
    currentCtx = { ...ctxConv, events: [...ctxConv.events, convEv] }

    // DIPLOMATIC_PLAY_STARTED event
    const { id: startEventId, ctx: ctxStart } = makeEventId(currentCtx)
    const startEv: SimEvent = {
      id: startEventId,
      year: ctxStart.state.currentYear,
      month: ctxStart.state.currentMonth,
      type: 'DIPLOMATIC_PLAY_STARTED',
      importance: 'normal',
      actorIds: [],
      houseIds: [],
      polityIds: [initiator.id, target.id],
      provinceIds: [intent.targetProvinceId],
      summary: `${buyerName} negotiates with ${sellerName} for ${provinceName}.`,
      reasons: [],
      effects: [],
    }
    currentCtx = { ...ctxStart, events: [...ctxStart.events, startEv] }
  }

  return currentCtx
}

function playDedupeKey(play: DiplomaticPlay): string | undefined {
  const provinceId = getPlayProvinceId(play)
  if (!provinceId) return undefined
  return `${play.kind}|${play.initiator.kind}:${play.initiator.id}|${play.target.kind}:${play.target.id}|${provinceId}`
}

function getPlayProvinceId(play: DiplomaticPlay): string | undefined {
  const d = play.primaryDemand
  if (d.kind === 'transfer_land_contract') return d.provinceId
  if (d.kind === 'revolt_concession') return d.provinceId
  return undefined
}

function setIntentStatus(
  ctx: TickContext,
  intentId: ActorIntentId,
  status: 'converted' | 'expired' | 'cancelled',
): TickContext {
  const intent = ctx.state.actorIntents[intentId]
  if (!intent) return ctx
  return {
    ...ctx,
    state: {
      ...ctx.state,
      actorIntents: {
        ...ctx.state.actorIntents,
        [intentId]: { ...intent, status },
      },
    },
  }
}
