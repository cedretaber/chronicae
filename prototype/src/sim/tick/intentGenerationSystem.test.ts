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
import type { HouseId, PolityId, ProvinceId } from '../types/ids'
import { runIntentGenerationSystem } from './intentGenerationSystem'
import { defaultLandContractConfig } from '../config/landContractConfig'

function buildWorld() {
  let s = makeEmptyV016State()
  const provinceBuyerId = 'pr-buyer' as ProvinceId
  const provinceSellerId = 'pr-seller' as ProvinceId
  const buyerPolityId = 'c-buyer' as PolityId
  const sellerPolityId = 'c-seller' as PolityId
  const buyerHouseId = 'h-buyer' as HouseId
  const sellerHouseId = 'h-seller' as HouseId

  s = withProvince(s, provinceBuyerId, { neighbors: [provinceSellerId], popGroupIds: [] })
  s = withProvince(s, provinceSellerId, {
    neighbors: [provinceBuyerId],
    popGroupIds: [],
    development: 0,
  })
  s = withHouse(s, buyerHouseId, { seatProvinceId: provinceBuyerId })
  s = withHouse(s, sellerHouseId, { seatProvinceId: provinceSellerId })
  s = withPolity(s, buyerPolityId, {
    rank: 2,
    treasury: defaultLandContractConfig.purchaseBuyerTreasuryThreshold + 1000,
    capitalProvinceId: provinceBuyerId,
  })
  s = withPolity(s, sellerPolityId, {
    rank: 2,
    treasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold - 100,
    capitalProvinceId: provinceSellerId,
  })
  s = bindProvinceToHouseViaPolity(s, provinceBuyerId, buyerPolityId, buyerHouseId)
  s = bindProvinceToHouseViaPolity(s, provinceSellerId, sellerPolityId, sellerHouseId)
  return { state: s, sellerPolityId, buyerPolityId, provinceSellerId }
}

function makeCtx(state: WorldState, currentMonth = 1) {
  const s = { ...state, currentMonth }
  return createTickContext({ state: s, rng: createRng('intent-test'), config: defaultConfig })
}

describe('runIntentGenerationSystem', () => {
  it('generates sell_land Intent when conditions are met', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    const ctx = makeCtx(state)
    const next = runIntentGenerationSystem(ctx)
    const intents = Object.values(next.state.actorIntents)
    expect(intents.length).toBe(1)
    const intent = intents[0]
    expect(intent?.kind).toBe('sell_land')
    expect(intent?.actor.id).toBe(sellerPolityId)
    expect(intent?.targetActor?.id).toBe(buyerPolityId)
    expect(intent?.targetProvinceId).toBe(provinceSellerId)
    expect(intent?.status).toBe('active')
    // ACTOR_INTENT_CREATED event 発火
    expect(next.events.some((e) => e.type === 'ACTOR_INTENT_CREATED')).toBe(true)
  })

  it('skips when month != 1', () => {
    const { state } = buildWorld()
    const ctx = makeCtx(state, 6)
    const next = runIntentGenerationSystem(ctx)
    expect(Object.keys(next.state.actorIntents).length).toBe(0)
  })

  it('does not duplicate Intent if already active', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    // 既存 sell_land Intent を inject
    const existing = {
      id: 'ai-existing' as import('../types/ids').ActorIntentId,
      actor: { kind: 'polity' as const, id: sellerPolityId },
      kind: 'sell_land' as const,
      targetActor: { kind: 'polity' as const, id: buyerPolityId },
      targetProvinceId: provinceSellerId,
      priority: 500,
      rationale: 'raise_revenue' as const,
      status: 'active' as const,
      createdYear: state.currentYear,
      createdMonth: 1,
      expiresYear: state.currentYear + 1,
      expiresMonth: 1,
    }
    const s = { ...state, actorIntents: { [existing.id]: existing } }
    const ctx = makeCtx(s)
    const next = runIntentGenerationSystem(ctx)
    // 既存 1 件のまま
    expect(Object.keys(next.state.actorIntents).length).toBe(1)
  })
})
