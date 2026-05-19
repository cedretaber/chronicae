import { describe, it, expect } from 'vitest'
import {
  makeEmptyV016State,
  withProvince,
  withPolity,
  withHouse,
  withPerson,
  bindProvinceToHouseViaPolity,
} from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import type { TickContext } from './context'
import { createTickContext } from './context'
import type { WorldState } from '../types/world'
import type {
  HouseId,
  PolityId,
  PersonId,
  ProvinceId,
  PopGroupId,
  DiplomaticPlayId,
} from '../types/ids'
import { createRebelPolity } from '../mutations/worldStructureMutations'
import { runDiplomaticPlaySystem } from './diplomaticPlaySystem'
import type { DiplomaticPlay } from '../types/diplomaticPlay'

function makeCtx(state: WorldState, seed = 'play-test'): TickContext {
  return createTickContext({ state, rng: createRng(seed), config: defaultConfig })
}

function setupRebel(unrest = 60, popSize = 1000) {
  let s = makeEmptyV016State()
  const provinceId = 'pr-1' as ProvinceId
  const polityId = 'c-1' as PolityId
  const houseId = 'h-1' as HouseId
  const leaderId = 'p-leader' as PersonId
  const popId = 'pg-peasants' as PopGroupId

  s = withProvince(s, provinceId, { popGroupIds: [popId] })
  s = withPolity(s, polityId, { treasury: 200, capitalProvinceId: provinceId })
  s = withHouse(s, houseId, { seatProvinceId: provinceId, wealth: 50 })
  s = withPerson(s, leaderId, { houseId, age: 35 })
  s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)
  s = {
    ...s,
    popGroups: {
      ...s.popGroups,
      [popId]: {
        id: popId,
        provinceId,
        class: 'peasants',
        size: popSize,
        wealth: 30,
        unrest,
        attitudes: {},
      },
    },
  }
  const ctx = makeCtx(s)
  const createResult = createRebelPolity(ctx, {
    provinceId,
    rebelClass: 'peasants',
    oldPolityId: polityId,
  })
  if (!createResult.ok) throw new Error(`createRebelPolity failed: ${createResult.error.message}`)
  return {
    ctx: createResult.value.ctx,
    provinceId,
    oldPolityId: polityId,
    rebelPolityId: createResult.value.value.polityId,
    popId,
  }
}

function injectPlay(
  ctx: TickContext,
  rebelPolityId: PolityId,
  oldPolityId: PolityId,
  provinceId: ProvinceId,
  popId: PopGroupId,
  overrides: Partial<DiplomaticPlay> = {},
): TickContext {
  const playId = `dp-test-1` as DiplomaticPlayId
  const play: DiplomaticPlay = {
    id: playId,
    kind: 'revolt_negotiation',
    initiator: { kind: 'polity', id: rebelPolityId },
    target: { kind: 'polity', id: oldPolityId },
    primaryDemand: {
      kind: 'revolt_concession',
      provinceId,
      popGroupId: popId,
      concessionLevel: 'minor',
    },
    status: 'active',
    startedYear: ctx.state.currentYear,
    startedMonth: ctx.state.currentMonth,
    deadlineYear: ctx.state.currentYear + 1,
    deadlineMonth: ctx.state.currentMonth,
    progress: 0,
    tension: 0,
    ...overrides,
  }
  return {
    ...ctx,
    state: {
      ...ctx.state,
      diplomaticPlays: { ...ctx.state.diplomaticPlays, [playId]: play },
    },
  }
}

describe('runDiplomaticPlaySystem', () => {
  it('skips when no active plays exist', () => {
    const s = makeEmptyV016State()
    const ctx = makeCtx(s)
    const next = runDiplomaticPlaySystem(ctx)
    expect(next).toBe(ctx)
  })

  it('skips non-revolt_negotiation plays (Stage B 制限)', () => {
    const setup = setupRebel()
    let ctx = setup.ctx
    const playId = 'dp-test-other' as DiplomaticPlayId
    const otherPlay: DiplomaticPlay = {
      id: playId,
      kind: 'land_purchase', // Stage B では非対応
      initiator: { kind: 'polity', id: setup.rebelPolityId },
      target: { kind: 'polity', id: setup.oldPolityId },
      primaryDemand: {
        kind: 'transfer_land_contract',
        provinceId: setup.provinceId,
        toPolityId: setup.oldPolityId,
      },
      status: 'active',
      startedYear: ctx.state.currentYear,
      startedMonth: ctx.state.currentMonth,
      deadlineYear: ctx.state.currentYear + 1,
      deadlineMonth: ctx.state.currentMonth,
      progress: 0,
      tension: 0,
    }
    ctx = {
      ...ctx,
      state: {
        ...ctx.state,
        diplomaticPlays: { [playId]: otherPlay },
      },
    }
    const next = runDiplomaticPlaySystem(ctx)
    // progress / tension が変わっていない
    expect(next.state.diplomaticPlays[playId]?.progress).toBe(0)
    expect(next.state.diplomaticPlays[playId]?.tension).toBe(0)
  })

  it('settled: progress reaches threshold → REVOLT_SETTLED + Polity inactive', () => {
    const setup = setupRebel(80) // high unrest → acceptanceScore high
    let ctx = injectPlay(
      setup.ctx,
      setup.rebelPolityId,
      setup.oldPolityId,
      setup.provinceId,
      setup.popId,
      {
        progress: 55, // すぐ threshold 60 を超えるよう設定
        tension: 0,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)

    const play = Object.values(ctx.state.diplomaticPlays)[0]
    // settled (terminal status) として set されている — cleanup phase は別 system なのでまだ Record にいる
    expect(play?.status).toBe('settled')
    expect(ctx.state.polities[setup.rebelPolityId]?.active).toBe(false)
    expect(ctx.events.some((e) => e.type === 'REVOLT_SETTLED')).toBe(true)
  })

  it('escalated: tension reaches threshold → resolved_by_conflict 経路', () => {
    const setup = setupRebel(10) // 低 unrest → acceptanceScore 低くなりやすい
    let ctx = injectPlay(
      setup.ctx,
      setup.rebelPolityId,
      setup.oldPolityId,
      setup.provinceId,
      setup.popId,
      {
        progress: 0,
        tension: 45, // すでに threshold 40 を超えた状態にして escalation 経路を強制
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('resolved_by_conflict')
    expect(
      ctx.events.some(
        (e) =>
          e.type === 'REVOLT_POLITY_ESTABLISHED' ||
          e.type === 'DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT',
      ),
    ).toBe(true)
  })

  it('deadline timeout: status=failed, Rebel Polity stays active (Stage B 制限)', () => {
    const setup = setupRebel(20)
    // deadline をすでに過ぎた状態で Play を inject
    let ctx = injectPlay(
      setup.ctx,
      setup.rebelPolityId,
      setup.oldPolityId,
      setup.provinceId,
      setup.popId,
      {
        progress: 5,
        tension: 5,
        deadlineYear: setup.ctx.state.currentYear,
        deadlineMonth: 1, // currentMonth=1 以下にしておく
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('failed')
    // Stage B 制限: Rebel Polity は active のまま
    expect(ctx.state.polities[setup.rebelPolityId]?.active).toBe(true)
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_FAILED')).toBe(true)
  })

  it('typical progress: status remains active, progress/tension updated', () => {
    const setup = setupRebel(50)
    let ctx = injectPlay(
      setup.ctx,
      setup.rebelPolityId,
      setup.oldPolityId,
      setup.provinceId,
      setup.popId,
      {
        progress: 0,
        tension: 0,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('active')
    // progress or tension のいずれかが増加している
    expect((play?.progress ?? 0) + (play?.tension ?? 0)).toBeGreaterThan(0)
  })
})

// v0.18 Stage C: land_purchase progression tests
describe('runDiplomaticPlaySystem (land_purchase)', () => {
  function setupLandPurchase(opts: { sellerTreasury?: number; buyerTreasury?: number }) {
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
    s = withPolity(s, buyerPolityId, {
      rank: 2,
      treasury: opts.buyerTreasury ?? 2000,
      capitalProvinceId: provinceBuyerId,
    })
    s = withPolity(s, sellerPolityId, {
      rank: 2,
      treasury: opts.sellerTreasury ?? 100,
      capitalProvinceId: provinceSellerId,
    })
    s = bindProvinceToHouseViaPolity(s, provinceBuyerId, buyerPolityId, buyerHouseId)
    s = bindProvinceToHouseViaPolity(s, provinceSellerId, sellerPolityId, sellerHouseId)
    return { state: s, buyerPolityId, sellerPolityId, provinceSellerId }
  }

  function injectLandPurchasePlay(
    ctx: TickContext,
    buyerPolityId: PolityId,
    sellerPolityId: PolityId,
    provinceId: ProvinceId,
    overrides: Partial<DiplomaticPlay> = {},
  ): TickContext {
    const playId = 'dp-lp-1' as DiplomaticPlayId
    const play: DiplomaticPlay = {
      id: playId,
      kind: 'land_purchase',
      initiator: { kind: 'polity', id: buyerPolityId },
      target: { kind: 'polity', id: sellerPolityId },
      primaryDemand: {
        kind: 'transfer_land_contract',
        provinceId,
        toPolityId: buyerPolityId,
      },
      counterDemand: {
        kind: 'pay_wealth',
        from: { kind: 'polity', id: buyerPolityId },
        to: { kind: 'polity', id: sellerPolityId },
        amount: 500,
      },
      status: 'active',
      startedYear: ctx.state.currentYear,
      startedMonth: ctx.state.currentMonth,
      deadlineYear: ctx.state.currentYear + 1,
      deadlineMonth: ctx.state.currentMonth,
      progress: 0,
      tension: 0,
      ...overrides,
    }
    return {
      ...ctx,
      state: {
        ...ctx.state,
        diplomaticPlays: { ...ctx.state.diplomaticPlays, [playId]: play },
      },
    }
  }

  it('settled: progress reaches threshold → LandContract transferred + treasury moved', () => {
    const setup = setupLandPurchase({ sellerTreasury: 50, buyerTreasury: 2000 })
    let ctx = makeCtx(setup.state)
    ctx = injectLandPurchasePlay(
      ctx,
      setup.buyerPolityId,
      setup.sellerPolityId,
      setup.provinceSellerId,
      {
        progress: 59, // すぐ threshold 60 を超える
        tension: 0,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('settled')
    // LandContract grantee が buyer に
    const terminalGrantee = ctx.state.provinceTerminalPolityCache[setup.provinceSellerId]
    expect(terminalGrantee).toBe(setup.buyerPolityId)
    // treasury 移動: buyer -500, seller +500
    expect(ctx.state.polities[setup.buyerPolityId]?.treasury).toBe(1500)
    expect(ctx.state.polities[setup.sellerPolityId]?.treasury).toBe(550)
    // events
    expect(ctx.events.some((e) => e.type === 'LAND_CONTRACT_PURCHASED')).toBe(true)
    expect(ctx.events.some((e) => e.type === 'LAND_CONTRACT_TRANSFERRED')).toBe(true)
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_SETTLED')).toBe(true)
  })

  it('deadline timeout: status=failed, no transfer', () => {
    const setup = setupLandPurchase({ sellerTreasury: 50, buyerTreasury: 2000 })
    let ctx = makeCtx(setup.state)
    ctx = injectLandPurchasePlay(
      ctx,
      setup.buyerPolityId,
      setup.sellerPolityId,
      setup.provinceSellerId,
      {
        progress: 5,
        tension: 5,
        deadlineYear: setup.state.currentYear,
        deadlineMonth: 1,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('failed')
    // LandContract grantee は seller のまま
    expect(ctx.state.provinceTerminalPolityCache[setup.provinceSellerId]).toBe(setup.sellerPolityId)
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_FAILED')).toBe(true)
  })

  it('cancelled: buyer treasury too low to pay → Play cancelled, no transfer', () => {
    const setup = setupLandPurchase({ sellerTreasury: 50, buyerTreasury: 100 })
    let ctx = makeCtx(setup.state)
    ctx = injectLandPurchasePlay(
      ctx,
      setup.buyerPolityId,
      setup.sellerPolityId,
      setup.provinceSellerId,
      {
        progress: 59,
        tension: 0,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('cancelled')
    // LandContract grantee は seller のまま
    expect(ctx.state.provinceTerminalPolityCache[setup.provinceSellerId]).toBe(setup.sellerPolityId)
  })
})
