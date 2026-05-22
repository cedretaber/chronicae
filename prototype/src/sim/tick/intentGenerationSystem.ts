import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { ActorIntentId } from '../types/ids'
import { createActorIntentId } from '../types/ids'
import type { ActorIntent } from '../types/actorIntent'
import { WEEKS_PER_YEAR } from '../utils/timeUtils'
import { entityRef } from '../types/event'
import { findLandPurchaseIntentCandidates } from '../selectors/landPurchaseCandidates'
import { findLandAcquireIntentCandidates } from '../selectors/landAcquireCandidates'
import {
  findTaxReductionCandidates,
  findTaxIncreaseCandidates,
} from '../selectors/taxRevisionCandidates'

// v0.18 Stage C §8.5 / Stage D §8.4: IntentGenerationSystem
// 年次 (月 1 のみ) 実行。短期 Intent を生成する。
//
// 生成 kind (Polity actor のみ):
//   - sell_land (Stage C): 財政難の seller が辺境 Province を売却したい
//   - acquire_land (Stage D): 軍事余裕のある acquirer が隣接 Province を狙う
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
      const sellerName = currentCtx.state.polities[sellerPolityId]?.nameKey ?? sellerPolityId
      const buyerName = currentCtx.state.polities[buyerPolityId]?.nameKey ?? buyerPolityId
      const provinceName = currentCtx.state.provinces[provinceId]?.nameKey ?? provinceId
      const { event, ctx: ctxEv } = createSimEvent(currentCtx, {
        type: 'ACTOR_INTENT_CREATED',
        importance: 'normal',
        messageKey: 'actor_intent.created_sell_land',
        messageParams: {
          seller: sellerName,
          province: provinceName,
          buyer: buyerName,
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

  // -- acquire_land (Stage D §8.4) --
  const acquireCandidates = findLandAcquireIntentCandidates(currentCtx.state, currentCtx.config)
  if (acquireCandidates.length > 0) {
    const existingAcquireKeys = new Set<string>()
    for (const intent of Object.values(currentCtx.state.actorIntents)) {
      if (!intent || intent.status !== 'active') continue
      if (intent.kind !== 'acquire_land') continue
      if (!intent.targetActor || intent.targetProvinceId === undefined) continue
      existingAcquireKeys.add(
        `${intent.actor.kind}:${intent.actor.id}|${intent.targetActor.kind}:${intent.targetActor.id}|${intent.targetProvinceId}`,
      )
    }

    for (const c of acquireCandidates) {
      const key = `polity:${c.acquirerPolityId}|polity:${c.targetPolityId}|${c.provinceId}`
      if (existingAcquireKeys.has(key)) continue

      const intentId: ActorIntentId = createActorIntentId(currentCtx.state.nextActorIntentId)
      const intent: ActorIntent = {
        id: intentId,
        actor: { kind: 'polity', id: c.acquirerPolityId },
        kind: 'acquire_land',
        targetActor: { kind: 'polity', id: c.targetPolityId },
        targetProvinceId: c.provinceId,
        priority: c.intentPriority,
        rationale: 'expand_territory',
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
      existingAcquireKeys.add(key)

      const acquirerPolityId = c.acquirerPolityId
      const targetPolityId = c.targetPolityId
      const provinceId = c.provinceId
      const acquirerName = currentCtx.state.polities[acquirerPolityId]?.nameKey ?? acquirerPolityId
      const targetName = currentCtx.state.polities[targetPolityId]?.nameKey ?? targetPolityId
      const provinceName = currentCtx.state.provinces[provinceId]?.nameKey ?? provinceId
      const { event, ctx: ctxEv } = createSimEvent(currentCtx, {
        type: 'ACTOR_INTENT_CREATED',
        importance: 'normal',
        messageKey: 'actor_intent.created_acquire_land',
        messageParams: { acquirer: acquirerName, province: provinceName, target: targetName },
        entityRefs: [
          entityRef('polity', acquirerPolityId, 'acquirer'),
          entityRef('polity', targetPolityId, 'target'),
          entityRef('province', provinceId, 'province'),
        ],
      })
      currentCtx = { ...ctxEv, events: [...ctxEv.events, event] }
    }
  }

  // -- improve_contract_terms (tax reduction) --
  const improveCandidates = findTaxReductionCandidates(currentCtx.state, currentCtx.config)
  if (improveCandidates.length > 0) {
    const existingImproveKeys = new Set<string>()
    for (const intent of Object.values(currentCtx.state.actorIntents)) {
      if (!intent || intent.status !== 'active') continue
      if (intent.kind !== 'improve_contract_terms') continue
      if (!intent.targetActor || intent.targetProvinceId === undefined) continue
      existingImproveKeys.add(
        `${intent.actor.kind}:${intent.actor.id}|${intent.targetActor.kind}:${intent.targetActor.id}|${intent.targetProvinceId}`,
      )
    }

    for (const c of improveCandidates) {
      const key = `polity:${c.initiatorPolityId}|polity:${c.targetPolityId}|${c.provinceId}`
      if (existingImproveKeys.has(key)) continue

      const intentId: ActorIntentId = createActorIntentId(currentCtx.state.nextActorIntentId)
      const intent: ActorIntent = {
        id: intentId,
        actor: { kind: 'polity', id: c.initiatorPolityId },
        kind: 'improve_contract_terms',
        targetActor: { kind: 'polity', id: c.targetPolityId },
        targetProvinceId: c.provinceId,
        priority: c.intentPriority,
        rationale: 'reduce_tribute',
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
      existingImproveKeys.add(key)

      const initiatorPolityId = c.initiatorPolityId
      const targetPolityId = c.targetPolityId
      const provinceId = c.provinceId
      const initiatorName =
        currentCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
      const targetName = currentCtx.state.polities[targetPolityId]?.nameKey ?? targetPolityId
      const provinceName = currentCtx.state.provinces[provinceId]?.nameKey ?? provinceId
      const { event, ctx: ctxEv } = createSimEvent(currentCtx, {
        type: 'ACTOR_INTENT_CREATED',
        importance: 'normal',
        messageKey: 'actor_intent.created_improve_terms',
        messageParams: { initiator: initiatorName, target: targetName, province: provinceName },
        entityRefs: [
          entityRef('polity', initiatorPolityId, 'initiator'),
          entityRef('polity', targetPolityId, 'target'),
          entityRef('province', provinceId, 'province'),
        ],
      })
      currentCtx = { ...ctxEv, events: [...ctxEv.events, event] }
    }
  }

  // -- demand_tax_increase --
  const increaseCandidates = findTaxIncreaseCandidates(currentCtx.state, currentCtx.config)
  if (increaseCandidates.length > 0) {
    const existingIncreaseKeys = new Set<string>()
    for (const intent of Object.values(currentCtx.state.actorIntents)) {
      if (!intent || intent.status !== 'active') continue
      if (intent.kind !== 'demand_tax_increase') continue
      if (!intent.targetActor || intent.targetProvinceId === undefined) continue
      existingIncreaseKeys.add(
        `${intent.actor.kind}:${intent.actor.id}|${intent.targetActor.kind}:${intent.targetActor.id}|${intent.targetProvinceId}`,
      )
    }

    for (const c of increaseCandidates) {
      const key = `polity:${c.initiatorPolityId}|polity:${c.targetPolityId}|${c.provinceId}`
      if (existingIncreaseKeys.has(key)) continue

      const intentId: ActorIntentId = createActorIntentId(currentCtx.state.nextActorIntentId)
      const intent: ActorIntent = {
        id: intentId,
        actor: { kind: 'polity', id: c.initiatorPolityId },
        kind: 'demand_tax_increase',
        targetActor: { kind: 'polity', id: c.targetPolityId },
        targetProvinceId: c.provinceId,
        priority: c.intentPriority,
        rationale: 'increase_tribute',
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
      existingIncreaseKeys.add(key)

      const initiatorPolityId = c.initiatorPolityId
      const targetPolityId = c.targetPolityId
      const provinceId = c.provinceId
      const initiatorName =
        currentCtx.state.polities[initiatorPolityId]?.nameKey ?? initiatorPolityId
      const targetName = currentCtx.state.polities[targetPolityId]?.nameKey ?? targetPolityId
      const provinceName = currentCtx.state.provinces[provinceId]?.nameKey ?? provinceId
      const { event, ctx: ctxEv } = createSimEvent(currentCtx, {
        type: 'ACTOR_INTENT_CREATED',
        importance: 'normal',
        messageKey: 'actor_intent.created_demand_tax',
        messageParams: { initiator: initiatorName, target: targetName, province: provinceName },
        entityRefs: [
          entityRef('polity', initiatorPolityId, 'initiator'),
          entityRef('polity', targetPolityId, 'target'),
          entityRef('province', provinceId, 'province'),
        ],
      })
      currentCtx = { ...ctxEv, events: [...ctxEv.events, event] }
    }
  }

  return currentCtx
}
