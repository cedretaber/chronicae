import { describe, it, expect } from 'vitest'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import type { WorldState } from '../types/world'
import type { ActorIntent } from '../types/actorIntent'
import type { ActorIntentId, HouseId, PolityId, ProvinceId, DiplomaticPlayId } from '../types/ids'
import type { DiplomaticPlay } from '../types/diplomaticPlay'
import { runIntentToDiplomaticPlaySystem } from './intentToDiplomaticPlaySystem'

function buildWorld(opts: { sameRank?: boolean } = {}) {
  let s = makeEmptyV016State()
  const provinceBuyerId = 'pr-buyer' as ProvinceId
  const provinceSellerId = 'pr-seller' as ProvinceId
  const buyerPolityId = 'c-buyer' as PolityId
  const sellerPolityId = 'c-seller' as PolityId
  const buyerHouseId = 'h-buyer' as HouseId
  const sellerHouseId = 'h-seller' as HouseId

  s = withProvince(s, provinceBuyerId, { neighbors: [provinceSellerId], popGroupIds: [] })
  s = withProvince(s, provinceSellerId, { neighbors: [provinceBuyerId], popGroupIds: [] })
  s = withHouse(s, buyerHouseId, { seatProvinceId: provinceBuyerId })
  s = withHouse(s, sellerHouseId, { seatProvinceId: provinceSellerId })
  s = withPolity(s, buyerPolityId, { rank: 2, treasury: 2000, capitalProvinceId: provinceBuyerId })
  s = withPolity(s, sellerPolityId, {
    rank: opts.sameRank === false ? 3 : 2,
    treasury: 100,
    capitalProvinceId: provinceSellerId,
  })
  s = bindProvinceToHouseViaPolity(s, provinceBuyerId, buyerPolityId, buyerHouseId)
  s = bindProvinceToHouseViaPolity(s, provinceSellerId, sellerPolityId, sellerHouseId)
  return { state: s, sellerPolityId, buyerPolityId, provinceSellerId, provinceBuyerId }
}

function makeSellLandIntent(
  id: string,
  sellerPolityId: PolityId,
  buyerPolityId: PolityId,
  provinceId: ProvinceId,
): ActorIntent {
  return {
    id: id as ActorIntentId,
    actor: { kind: 'polity', id: sellerPolityId },
    kind: 'sell_land',
    targetActor: { kind: 'polity', id: buyerPolityId },
    targetProvinceId: provinceId,
    priority: 500,
    rationale: 'raise_revenue',
    status: 'active',
    createdYear: 1000,
    createdMonth: 1,
    expiresYear: 1001,
    expiresMonth: 1,
  }
}

function makeAcquireLandIntent(
  id: string,
  acquirerPolityId: PolityId,
  targetPolityId: PolityId,
  provinceId: ProvinceId,
): ActorIntent {
  return {
    id: id as ActorIntentId,
    actor: { kind: 'polity', id: acquirerPolityId },
    kind: 'acquire_land',
    targetActor: { kind: 'polity', id: targetPolityId },
    targetProvinceId: provinceId,
    priority: 100,
    rationale: 'expand_territory',
    status: 'active',
    createdYear: 1000,
    createdMonth: 1,
    expiresYear: 1001,
    expiresMonth: 1,
  }
}

function makeCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('itp-test'), config: defaultConfig })
}

describe('runIntentToDiplomaticPlaySystem', () => {
  it('converts sell_land Intent → land_purchase Play (initiator=buyer, target=seller)', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    const intent = makeSellLandIntent('ai-1', sellerPolityId, buyerPolityId, provinceSellerId)
    const s = { ...state, actorIntents: { [intent.id]: intent } }
    const ctx = makeCtx(s)
    const next = runIntentToDiplomaticPlaySystem(ctx)
    expect(next.state.actorIntents[intent.id]?.status).toBe('converted')
    const plays = Object.values(next.state.diplomaticPlays)
    expect(plays.length).toBe(1)
    const play = plays[0]
    expect(play?.kind).toBe('land_purchase')
    expect(play?.initiator.id).toBe(buyerPolityId)
    expect(play?.target.id).toBe(sellerPolityId)
    expect(play?.status).toBe('active')
    if (play?.primaryDemand.kind === 'transfer_land_contract') {
      expect(play.primaryDemand.provinceId).toBe(provinceSellerId)
      expect(play.primaryDemand.toPolityId).toBe(buyerPolityId)
    } else {
      throw new Error('expected transfer_land_contract demand')
    }
    if (play?.counterDemand?.kind === 'pay_wealth') {
      expect(play.counterDemand.from.id).toBe(buyerPolityId)
      expect(play.counterDemand.to.id).toBe(sellerPolityId)
      expect(play.counterDemand.amount).toBe(500)
    } else {
      throw new Error('expected pay_wealth counter')
    }
    expect(next.events.some((e) => e.type === 'ACTOR_INTENT_CONVERTED')).toBe(true)
    expect(next.events.some((e) => e.type === 'DIPLOMATIC_PLAY_STARTED')).toBe(true)
  })

  it('suppresses duplicate Play when an active land_purchase already exists for same (buyer, seller, province)', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    const existingPlay: DiplomaticPlay = {
      id: 'dp-existing' as DiplomaticPlayId,
      kind: 'land_purchase',
      initiator: { kind: 'polity', id: buyerPolityId },
      target: { kind: 'polity', id: sellerPolityId },
      primaryDemand: {
        kind: 'transfer_land_contract',
        provinceId: provinceSellerId,
        toPolityId: buyerPolityId,
      },
      status: 'active',
      startedYear: 1000,
      startedMonth: 1,
      deadlineYear: 1000,
      deadlineMonth: 7,
      progress: 0,
      tension: 0,
    }
    const intent = makeSellLandIntent('ai-1', sellerPolityId, buyerPolityId, provinceSellerId)
    const s = {
      ...state,
      diplomaticPlays: { [existingPlay.id]: existingPlay },
      actorIntents: { [intent.id]: intent },
    }
    const ctx = makeCtx(s)
    const next = runIntentToDiplomaticPlaySystem(ctx)
    expect(next.state.actorIntents[intent.id]?.status).toBe('expired')
    expect(Object.keys(next.state.diplomaticPlays).length).toBe(1)
  })

  it('marks Intent expired if targetActor missing', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    const intent: ActorIntent = {
      ...makeSellLandIntent('ai-1', sellerPolityId, buyerPolityId, provinceSellerId),
    }
    delete (intent as { targetActor?: unknown }).targetActor
    const s = { ...state, actorIntents: { [intent.id]: intent } }
    const ctx = makeCtx(s)
    const next = runIntentToDiplomaticPlaySystem(ctx)
    expect(next.state.actorIntents[intent.id]?.status).toBe('expired')
    expect(Object.keys(next.state.diplomaticPlays).length).toBe(0)
  })

  // v0.18 Stage D: acquire_land 経路
  it('converts acquire_land Intent → land_purchase Play when same rank + same grantor + acquirer rich', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    // acquirer = buyer (rank 2, treasury 2000), target = seller (rank 2)
    // Both bound via ROOT_WORLD so same grantor.
    const intent = makeAcquireLandIntent('ai-1', buyerPolityId, sellerPolityId, provinceSellerId)
    const s = { ...state, actorIntents: { [intent.id]: intent } }
    const ctx = makeCtx(s)
    const next = runIntentToDiplomaticPlaySystem(ctx)
    expect(next.state.actorIntents[intent.id]?.status).toBe('converted')
    const plays = Object.values(next.state.diplomaticPlays)
    expect(plays.length).toBe(1)
    const play = plays[0]
    expect(play?.kind).toBe('land_purchase')
    expect(play?.initiator.id).toBe(buyerPolityId) // initiator = acquirer
    expect(play?.target.id).toBe(sellerPolityId) // target = defender
    if (play?.counterDemand?.kind === 'pay_wealth') {
      expect(play.counterDemand.from.id).toBe(buyerPolityId)
      expect(play.counterDemand.to.id).toBe(sellerPolityId)
      expect(play.counterDemand.amount).toBeGreaterThan(0)
    } else {
      throw new Error('expected pay_wealth counter')
    }
  })

  it('converts acquire_land Intent → land_transfer_demand Play when ranks differ', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld({
      sameRank: false,
    })
    const intent = makeAcquireLandIntent('ai-1', buyerPolityId, sellerPolityId, provinceSellerId)
    const s = { ...state, actorIntents: { [intent.id]: intent } }
    const ctx = makeCtx(s)
    const next = runIntentToDiplomaticPlaySystem(ctx)
    expect(next.state.actorIntents[intent.id]?.status).toBe('converted')
    const plays = Object.values(next.state.diplomaticPlays)
    expect(plays.length).toBe(1)
    const play = plays[0]
    expect(play?.kind).toBe('land_transfer_demand')
    expect(play?.initiator.id).toBe(buyerPolityId)
    expect(play?.target.id).toBe(sellerPolityId)
    expect(play?.counterDemand).toBeUndefined()
    if (play?.primaryDemand.kind === 'transfer_land_contract') {
      expect(play.primaryDemand.toPolityId).toBe(buyerPolityId)
      expect(play.primaryDemand.provinceId).toBe(provinceSellerId)
    } else {
      throw new Error('expected transfer_land_contract demand')
    }
  })

  it('marks acquire_land Intent expired when target is commonwealth', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    // seller を commonwealth に変換
    const sNoOwner = {
      ...state,
      polities: {
        ...state.polities,
        [sellerPolityId]: {
          ...state.polities[sellerPolityId]!,
          ownerHouseId: undefined,
          kind: 'commonwealth' as const,
        },
      },
    }
    const intent = makeAcquireLandIntent('ai-1', buyerPolityId, sellerPolityId, provinceSellerId)
    const s = { ...sNoOwner, actorIntents: { [intent.id]: intent } }
    const ctx = makeCtx(s)
    const next = runIntentToDiplomaticPlaySystem(ctx)
    expect(next.state.actorIntents[intent.id]?.status).toBe('expired')
    expect(Object.keys(next.state.diplomaticPlays).length).toBe(0)
  })
})
