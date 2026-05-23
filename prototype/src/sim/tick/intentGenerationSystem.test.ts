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

  s = withProvince(s, provinceBuyerId, { neighbors: [provinceSellerId] })
  s = withProvince(s, provinceSellerId, {
    neighbors: [provinceBuyerId],
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
  return { state: s, sellerPolityId, buyerPolityId, provinceSellerId, provinceBuyerId }
}

function makeCtx(
  state: WorldState,
  currentWeekOfYear = 1,
  configOverride?: Partial<typeof defaultConfig>,
) {
  const s = {
    ...state,
    currentWeekOfYear,
    absoluteWeek: state.currentYear * 48 + currentWeekOfYear - 1,
  }
  return createTickContext({
    state: s,
    rng: createRng('intent-test'),
    config: { ...defaultConfig, ...configOverride },
  })
}

describe('runIntentGenerationSystem', () => {
  it('generates sell_land Intent when conditions are met', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    const ctx = makeCtx(state, 1)
    const next = runIntentGenerationSystem(ctx)
    const intents = Object.values(next.state.actorIntents)
    const sellIntents = intents.filter((i) => i?.kind === 'sell_land')
    expect(sellIntents.length).toBe(1)
    const intent = sellIntents[0]
    expect(intent?.actor.id).toBe(sellerPolityId)
    expect(intent?.targetActor?.id).toBe(buyerPolityId)
    expect(intent?.targetProvinceId).toBe(provinceSellerId)
    expect(intent?.status).toBe('active')
    expect(next.events.some((e) => e.type === 'ACTOR_INTENT_CREATED')).toBe(true)
  })

  it('does not duplicate sell_land Intent if already active', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    const existing = {
      id: 'ai-existing' as import('../types/ids').ActorIntentId,
      actor: { kind: 'polity' as const, id: sellerPolityId },
      kind: 'sell_land' as const,
      targetActor: { kind: 'polity' as const, id: buyerPolityId },
      targetProvinceId: provinceSellerId,
      priority: 500,
      rationale: 'raise_revenue' as const,
      status: 'active' as const,
      createdWeek: state.currentYear * 48 + 1 - 1,
      expiresWeek: (state.currentYear + 1) * 48 + 1 - 1,
    }
    const s = { ...state, actorIntents: { [existing.id]: existing } }
    const ctx = makeCtx(s, 1)
    const next = runIntentGenerationSystem(ctx)
    expect(Object.keys(next.state.actorIntents).length).toBe(1)
  })
})
