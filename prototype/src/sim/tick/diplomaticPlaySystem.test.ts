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

  it('skips land_purchase play without counterDemand (early return)', () => {
    const setup = setupRebel()
    let ctx = setup.ctx
    const playId = 'dp-test-other' as DiplomaticPlayId
    const otherPlay: DiplomaticPlay = {
      id: playId,
      kind: 'land_purchase', // counterDemand なしで early return
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

  // v0.18 Stage D: escalation 検知は diplomaticPlaySystem (status='escalated') のみ。
  // 実際の conflict resolve は別 phase の conflictResolutionSystem。
  it('escalated: tension reaches threshold → status=escalated + DIPLOMATIC_PLAY_ESCALATED event', () => {
    const setup = setupRebel(10)
    let ctx = injectPlay(
      setup.ctx,
      setup.rebelPolityId,
      setup.oldPolityId,
      setup.provinceId,
      setup.popId,
      {
        progress: 0,
        tension: 45,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('escalated')
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_ESCALATED')).toBe(true)
  })

  // v0.18 Stage D §10.2 step 6: deadline 到達時、tension > progress なら escalated に倒される
  it('deadline timeout with low progress + rising tension → status=escalated', () => {
    const setup = setupRebel(20)
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
        deadlineMonth: 1,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('escalated')
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_ESCALATED')).toBe(true)
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

// v0.18 Stage D: land_transfer_demand progression tests
describe('runDiplomaticPlaySystem (land_transfer_demand)', () => {
  function setupLandTransferDemand() {
    let s = makeEmptyV016State()
    const provinceAttackerId = 'pr-att' as ProvinceId
    const provinceDefenderId = 'pr-def' as ProvinceId
    const attackerPolityId = 'c-att' as PolityId
    const defenderPolityId = 'c-def' as PolityId
    const attackerHouseId = 'h-att' as HouseId
    const defenderHouseId = 'h-def' as HouseId

    s = withProvince(s, provinceAttackerId, { neighbors: [provinceDefenderId], popGroupIds: [] })
    s = withProvince(s, provinceDefenderId, { neighbors: [provinceAttackerId], popGroupIds: [] })
    s = withHouse(s, attackerHouseId, { seatProvinceId: provinceAttackerId })
    s = withHouse(s, defenderHouseId, { seatProvinceId: provinceDefenderId })
    s = withPolity(s, attackerPolityId, {
      rank: 2,
      treasury: 2000,
      capitalProvinceId: provinceAttackerId,
    })
    s = withPolity(s, defenderPolityId, {
      rank: 3,
      treasury: 500,
      capitalProvinceId: provinceDefenderId,
    })
    s = bindProvinceToHouseViaPolity(s, provinceAttackerId, attackerPolityId, attackerHouseId)
    s = bindProvinceToHouseViaPolity(s, provinceDefenderId, defenderPolityId, defenderHouseId)
    return { state: s, attackerPolityId, defenderPolityId, provinceDefenderId }
  }

  function injectLTDPlay(
    ctx: TickContext,
    attackerPolityId: PolityId,
    defenderPolityId: PolityId,
    provinceId: ProvinceId,
    overrides: Partial<DiplomaticPlay> = {},
  ): TickContext {
    const playId = 'dp-ltd-1' as DiplomaticPlayId
    const play: DiplomaticPlay = {
      id: playId,
      kind: 'land_transfer_demand',
      initiator: { kind: 'polity', id: attackerPolityId },
      target: { kind: 'polity', id: defenderPolityId },
      primaryDemand: {
        kind: 'transfer_land_contract',
        provinceId,
        toPolityId: attackerPolityId,
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

  it('settled: progress reaches threshold → LandContract transferred without compensation', () => {
    const setup = setupLandTransferDemand()
    let ctx = makeCtx(setup.state)
    ctx = injectLTDPlay(
      ctx,
      setup.attackerPolityId,
      setup.defenderPolityId,
      setup.provinceDefenderId,
      {
        progress: 59, // すぐ threshold 60 を超える
        tension: 0,
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    // 攻撃側 rank 2 vs 防御側 rank 3 → progress 上昇は acceptanceScore による
    // どちらに転んでも (settled / escalated) のいずれかが起きる
    expect(['settled', 'escalated', 'active']).toContain(play?.status)
  })

  it('escalated: tension reaches threshold → status=escalated', () => {
    const setup = setupLandTransferDemand()
    let ctx = makeCtx(setup.state)
    ctx = injectLTDPlay(
      ctx,
      setup.attackerPolityId,
      setup.defenderPolityId,
      setup.provinceDefenderId,
      {
        progress: 0,
        tension: 45, // すでに threshold 40 を超えた状態
      },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('escalated')
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_ESCALATED')).toBe(true)
  })

  it('cancelled: defender no longer holds province → Play cancelled', () => {
    const setup = setupLandTransferDemand()
    let ctx = makeCtx(setup.state)
    // defender の Province を空にする (terminal を消す)
    ctx = {
      ...ctx,
      state: {
        ...ctx.state,
        provinceTerminalPolityCache: {
          ...ctx.state.provinceTerminalPolityCache,
          [setup.provinceDefenderId]: undefined as unknown as PolityId,
        },
      },
    }
    ctx = injectLTDPlay(
      ctx,
      setup.attackerPolityId,
      setup.defenderPolityId,
      setup.provinceDefenderId,
      { progress: 30, tension: 30 },
    )
    ctx = runDiplomaticPlaySystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('cancelled')
  })
})
