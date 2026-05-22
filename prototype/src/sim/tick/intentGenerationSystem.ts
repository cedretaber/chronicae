import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { ActorIntentId } from '../types/ids'
import { createActorIntentId } from '../types/ids'
import type { ActorIntent } from '../types/actorIntent'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import { entityRef, nameParam } from '../types/event'
import { findLandPurchaseIntentCandidates } from '../selectors/landPurchaseCandidates'

// v0.18 Stage C §8.5: IntentGenerationSystem
// 年次 (月 1 のみ) 実行。短期 Intent を生成する。
//
// 生成 kind (Polity actor のみ):
//   - sell_land (Stage C): 財政難の seller が辺境 Province を売却したい
//
// House actor の Intent は spec §8.7 により v0.18 では生成しない。

export function runIntentGenerationSystem(ctx: TickContext): TickContext {
  let currentCtx = ctx

  // -- sell_land --
  const sellCandidates = findLandPurchaseIntentCandidates(currentCtx.state)
  if (sellCandidates.length > 0) {
    const existingSellKeys = new Set<string>()
    for (const intent of Object.values(currentCtx.state.actorIntents)) {
      if (!intent || intent.status !== 'active') continue
      if (intent.kind !== 'sell_land') continue
      if (!intent.targetActor || intent.targetProvinceId === undefined) continue
      existingSellKeys.add(
        `${intent.actor.kind}:${intent.actor.id}|${intent.targetActor.kind}:${intent.targetActor.id}|${intent.targetProvinceId}`,
      )
    }

    for (const c of sellCandidates) {
      const key = `polity:${c.sellerPolityId}|polity:${c.buyerPolityId}|${c.provinceId}`
      if (existingSellKeys.has(key)) continue

      const intentId: ActorIntentId = createActorIntentId(currentCtx.state.nextActorIntentId)
      const intent: ActorIntent = {
        id: intentId,
        actor: { kind: 'polity', id: c.sellerPolityId },
        kind: 'sell_land',
        targetActor: { kind: 'polity', id: c.buyerPolityId },
        targetProvinceId: c.provinceId,
        priority: c.price,
        rationale: 'raise_revenue',
        status: 'active',
        createdWeek: currentCtx.state.absoluteWeek,
        expiresWeek: currentCtx.state.absoluteWeek + WEEKS_PER_YEAR,
      }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          actorIntents: {
            ...currentCtx.state.actorIntents,
            [intentId]: intent,
          },
          nextActorIntentId: currentCtx.state.nextActorIntentId + 1,
        },
      }
      existingSellKeys.add(key)

      const sellerPolityId = c.sellerPolityId
      const buyerPolityId = c.buyerPolityId
      const provinceId = c.provinceId
      const sellerNameKey = currentCtx.state.polities[sellerPolityId]?.nameKey ?? sellerPolityId
      const buyerNameKey = currentCtx.state.polities[buyerPolityId]?.nameKey ?? buyerPolityId
      const provinceNameKey = currentCtx.state.provinces[provinceId]?.nameKey ?? provinceId
      const { event, ctx: ctxEv } = createSimEvent(currentCtx, {
        type: 'ACTOR_INTENT_CREATED',
        importance: 'normal',
        messageKey: 'actor_intent.created_sell_land',
        messageParams: {
          seller: nameParam('polity', sellerNameKey),
          province: nameParam('province', provinceNameKey),
          buyer: nameParam('polity', buyerNameKey),
          price: Math.round(c.price),
        },
        entityRefs: [
          entityRef('polity', sellerPolityId, 'seller'),
          entityRef('polity', buyerPolityId, 'buyer'),
          entityRef('province', provinceId, 'province'),
        ],
      })
      currentCtx = { ...ctxEv, events: [...ctxEv.events, event] }
    }
  }

  return currentCtx
}
