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
  it('generates sell_land Intent when conditions are met (acquire_land disabled)', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    const ctx = makeCtx(state, 1, { acquireLandIntentEnabled: false })
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
    // acquire_land を無効化して sell_land の重複防止のみを検証
    const ctx = makeCtx(s, 1, { acquireLandIntentEnabled: false })
    const next = runIntentGenerationSystem(ctx)
    expect(Object.keys(next.state.actorIntents).length).toBe(1)
  })

  // v0.18 Stage D: acquire_land
  it('generates acquire_land Intent when acquirer has treasury and adjacent target', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    // sell_land を無効化して acquire_land 単独動作を検証
    // (defaultLandContractConfig.purchaseSellerTreasuryThreshold は別 module で
    //  config override しても効かないため、seller treasury を threshold 以上に上書き)
    const stateNoSell = {
      ...state,
      polities: {
        ...state.polities,
        [sellerPolityId]: {
          ...state.polities[sellerPolityId]!,
          treasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold + 100,
        },
      },
    }
    const ctx = makeCtx(stateNoSell)
    const next = runIntentGenerationSystem(ctx)
    const intents = Object.values(next.state.actorIntents)
    const acquireIntents = intents.filter((i) => i?.kind === 'acquire_land')
    expect(acquireIntents.length).toBeGreaterThanOrEqual(1)
    const intent = acquireIntents[0]
    // acquirer = buyer (rich Polity), target = seller, province = seller の Province
    expect(intent?.actor.id).toBe(buyerPolityId)
    expect(intent?.targetActor?.id).toBe(sellerPolityId)
    expect(intent?.targetProvinceId).toBe(provinceSellerId)
    expect(intent?.rationale).toBe('expand_territory')
  })

  it('emits ACTOR_INTENT_CREATED for acquire_land Intent', () => {
    const { state, sellerPolityId } = buildWorld()
    const stateNoSell = {
      ...state,
      polities: {
        ...state.polities,
        [sellerPolityId]: {
          ...state.polities[sellerPolityId]!,
          treasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold + 100,
        },
      },
    }
    const ctx = makeCtx(stateNoSell)
    const next = runIntentGenerationSystem(ctx)
    // event の summary に "eyes" (acquire_land 用) が入っていること
    const acquireEvent = next.events.find(
      (e) => e.type === 'ACTOR_INTENT_CREATED' && e.messageKey.includes('acquire'),
    )
    expect(acquireEvent).toBeDefined()
  })

  it('does not duplicate acquire_land Intent if already active', () => {
    const { state, sellerPolityId, buyerPolityId, provinceSellerId } = buildWorld()
    // seller の treasury を threshold 以上 + acquireLandMinTreasury 未満にして
    //   sell_land を起こさず、かつ seller を acquirer にもしない
    const stateNoSell = {
      ...state,
      polities: {
        ...state.polities,
        [sellerPolityId]: {
          ...state.polities[sellerPolityId]!,
          treasury: defaultLandContractConfig.purchaseSellerTreasuryThreshold + 100,
        },
      },
    }
    const existing = {
      id: 'ai-existing-acquire' as import('../types/ids').ActorIntentId,
      actor: { kind: 'polity' as const, id: buyerPolityId },
      kind: 'acquire_land' as const,
      targetActor: { kind: 'polity' as const, id: sellerPolityId },
      targetProvinceId: provinceSellerId,
      priority: 100,
      rationale: 'expand_territory' as const,
      status: 'active' as const,
      createdWeek: state.currentYear * 48 + 1 - 1,
      expiresWeek: (state.currentYear + 1) * 48 + 1 - 1,
    }
    const s = { ...stateNoSell, actorIntents: { [existing.id]: existing } }
    const ctx = makeCtx(s)
    const next = runIntentGenerationSystem(ctx)
    // buyer→seller 方向の acquire_land は重複しない (既存 1 件のまま)。
    // seller→buyer 方向は別の Intent (許容)。
    const buyerAcquires = Object.values(next.state.actorIntents).filter(
      (i) => i?.kind === 'acquire_land' && i.actor.id === buyerPolityId,
    )
    expect(buyerAcquires.length).toBe(1)
  })
})
