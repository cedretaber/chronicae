import type { TickContext } from './context'
import { makeEventId } from './context'
import type { ActorIntentId } from '../types/ids'
import { createActorIntentId } from '../types/ids'
import type { ActorIntent } from '../types/actorIntent'
import type { SimEvent } from '../types/event'
import { findLandPurchaseIntentCandidates } from '../selectors/landPurchaseCandidates'

// v0.18 Stage C §8.5: IntentGenerationSystem
// 年次 (月 1 のみ) 実行。短期 Intent を生成する。
// Stage C では sell_land Intent のみ (Polity 主体)。
// 他 Intent kind (acquire_land 等) は Stage D 以降で追加。
//
// sell_land Intent:
//   - 旧 landContractPurchaseSystem の候補生成を再利用 (findLandPurchaseIntentCandidates)
//   - actor = seller polity
//   - targetActor = buyer polity
//   - targetProvinceId = 譲渡対象の Province
//   - priority = price (暫定: 高価な Province ほど優先)

export function runIntentGenerationSystem(ctx: TickContext): TickContext {
  if (ctx.state.currentMonth !== 1) return ctx

  const candidates = findLandPurchaseIntentCandidates(ctx.state)
  if (candidates.length === 0) return ctx

  let currentCtx = ctx

  // 同じ (seller, buyer, province) 組み合わせの active sell_land Intent が既に存在する場合は skip
  // (年次実行なので通常重複しないが、defensive)
  const existingKeys = new Set<string>()
  for (const intent of Object.values(currentCtx.state.actorIntents)) {
    if (!intent || intent.status !== 'active') continue
    if (intent.kind !== 'sell_land') continue
    if (!intent.targetActor || intent.targetProvinceId === undefined) continue
    existingKeys.add(
      `${intent.actor.kind}:${intent.actor.id}|${intent.targetActor.kind}:${intent.targetActor.id}|${intent.targetProvinceId}`,
    )
  }

  for (const c of candidates) {
    const key = `polity:${c.sellerPolityId}|polity:${c.buyerPolityId}|${c.provinceId}`
    if (existingKeys.has(key)) continue

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
      createdYear: currentCtx.state.currentYear,
      createdMonth: currentCtx.state.currentMonth,
      expiresYear: currentCtx.state.currentYear + 1,
      expiresMonth: currentCtx.state.currentMonth,
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
    existingKeys.add(key)

    // ACTOR_INTENT_CREATED event
    const { id: eventId, ctx: ctxEv } = makeEventId(currentCtx)
    const sellerName = ctxEv.state.polities[c.sellerPolityId]?.name ?? c.sellerPolityId
    const buyerName = ctxEv.state.polities[c.buyerPolityId]?.name ?? c.buyerPolityId
    const provinceName = ctxEv.state.provinces[c.provinceId]?.name ?? c.provinceId
    const ev: SimEvent = {
      id: eventId,
      year: ctxEv.state.currentYear,
      month: ctxEv.state.currentMonth,
      type: 'ACTOR_INTENT_CREATED',
      importance: 'normal',
      actorIds: [],
      houseIds: [],
      polityIds: [c.sellerPolityId, c.buyerPolityId],
      provinceIds: [c.provinceId],
      summary: `${sellerName} seeks to sell ${provinceName} to ${buyerName} for ${Math.round(c.price)} gold.`,
      reasons: [],
      effects: [],
    }
    currentCtx = { ...ctxEv, events: [...ctxEv.events, ev] }
  }

  return currentCtx
}
