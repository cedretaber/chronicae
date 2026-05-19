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
import { runConflictResolutionSystem } from './conflictResolutionSystem'
import type { DiplomaticPlay } from '../types/diplomaticPlay'

function makeCtx(state: WorldState, seed = 'conflict-test'): TickContext {
  return createTickContext({ state, rng: createRng(seed), config: defaultConfig })
}

describe('runConflictResolutionSystem (revolt_negotiation)', () => {
  function setupRebel() {
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
          size: 1000,
          wealth: 30,
          unrest: 50,
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

  function injectEscalatedPlay(
    ctx: TickContext,
    rebelPolityId: PolityId,
    oldPolityId: PolityId,
    provinceId: ProvinceId,
    popId: PopGroupId,
  ): TickContext {
    const playId = 'dp-revolt-esc' as DiplomaticPlayId
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
      status: 'escalated',
      startedYear: ctx.state.currentYear,
      startedMonth: ctx.state.currentMonth,
      deadlineYear: ctx.state.currentYear + 1,
      deadlineMonth: ctx.state.currentMonth,
      progress: 30,
      tension: 70,
    }
    return {
      ...ctx,
      state: {
        ...ctx.state,
        diplomaticPlays: { ...ctx.state.diplomaticPlays, [playId]: play },
      },
    }
  }

  it('resolves escalated revolt → status=resolved_by_conflict', () => {
    const setup = setupRebel()
    let ctx = injectEscalatedPlay(
      setup.ctx,
      setup.rebelPolityId,
      setup.oldPolityId,
      setup.provinceId,
      setup.popId,
    )
    ctx = runConflictResolutionSystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('resolved_by_conflict')
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT')).toBe(true)
  })

  it('ignores active (non-escalated) Plays', () => {
    const setup = setupRebel()
    const playId = 'dp-revolt-active' as DiplomaticPlayId
    const play: DiplomaticPlay = {
      id: playId,
      kind: 'revolt_negotiation',
      initiator: { kind: 'polity', id: setup.rebelPolityId },
      target: { kind: 'polity', id: setup.oldPolityId },
      primaryDemand: {
        kind: 'revolt_concession',
        provinceId: setup.provinceId,
        popGroupId: setup.popId,
        concessionLevel: 'minor',
      },
      status: 'active',
      startedYear: setup.ctx.state.currentYear,
      startedMonth: setup.ctx.state.currentMonth,
      deadlineYear: setup.ctx.state.currentYear + 1,
      deadlineMonth: setup.ctx.state.currentMonth,
      progress: 50,
      tension: 30,
    }
    const ctx0: TickContext = {
      ...setup.ctx,
      state: {
        ...setup.ctx.state,
        diplomaticPlays: { ...setup.ctx.state.diplomaticPlays, [playId]: play },
      },
    }
    const next = runConflictResolutionSystem(ctx0)
    expect(next.state.diplomaticPlays[playId]?.status).toBe('active')
  })
})

describe('runConflictResolutionSystem (land_transfer_demand)', () => {
  function setupLTD() {
    let s = makeEmptyV016State()
    const provinceAttackerId = 'pr-att' as ProvinceId
    const provinceDefenderId = 'pr-def' as ProvinceId
    const attackerPolityId = 'c-att' as PolityId
    const defenderPolityId = 'c-def' as PolityId
    const attackerHouseId = 'h-att' as HouseId
    const defenderHouseId = 'h-def' as HouseId

    s = withProvince(s, provinceAttackerId, { neighbors: [provinceDefenderId], popGroupIds: [] })
    s = withProvince(s, provinceDefenderId, { neighbors: [provinceAttackerId], popGroupIds: [] })
    s = withHouse(s, attackerHouseId, { seatProvinceId: provinceAttackerId, wealth: 200 })
    s = withHouse(s, defenderHouseId, { seatProvinceId: provinceDefenderId, wealth: 50 })
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

  function injectEscalatedLTDPlay(
    ctx: TickContext,
    attackerPolityId: PolityId,
    defenderPolityId: PolityId,
    provinceId: ProvinceId,
  ): TickContext {
    const playId = 'dp-ltd-esc' as DiplomaticPlayId
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
      status: 'escalated',
      startedYear: ctx.state.currentYear,
      startedMonth: ctx.state.currentMonth,
      deadlineYear: ctx.state.currentYear + 1,
      deadlineMonth: ctx.state.currentMonth,
      progress: 10,
      tension: 70,
    }
    return {
      ...ctx,
      state: {
        ...ctx.state,
        diplomaticPlays: { ...ctx.state.diplomaticPlays, [playId]: play },
      },
    }
  }

  it('resolves escalated land_transfer_demand → status=resolved_by_conflict + WAR_WON/LOST', () => {
    const setup = setupLTD()
    let ctx = makeCtx(setup.state)
    ctx = injectEscalatedLTDPlay(
      ctx,
      setup.attackerPolityId,
      setup.defenderPolityId,
      setup.provinceDefenderId,
    )
    ctx = runConflictResolutionSystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    expect(play?.status).toBe('resolved_by_conflict')
    expect(ctx.events.some((e) => e.type === 'WAR_WON')).toBe(true)
    expect(ctx.events.some((e) => e.type === 'WAR_LOST')).toBe(true)
    expect(ctx.events.some((e) => e.type === 'DIPLOMATIC_PLAY_RESOLVED_BY_CONFLICT')).toBe(true)
  })

  it('updates lastWarMonth on both Polities after conflict', () => {
    const setup = setupLTD()
    let ctx = makeCtx(setup.state)
    ctx = injectEscalatedLTDPlay(
      ctx,
      setup.attackerPolityId,
      setup.defenderPolityId,
      setup.provinceDefenderId,
    )
    ctx = runConflictResolutionSystem(ctx)
    const expected = ctx.state.currentYear * 12 + ctx.state.currentMonth
    expect(ctx.state.polities[setup.attackerPolityId]?.lastWarMonth).toBe(expected)
    expect(ctx.state.polities[setup.defenderPolityId]?.lastWarMonth).toBe(expected)
  })

  it('cancels Play when conflictResolutionEnabled=false', () => {
    const setup = setupLTD()
    let ctx = makeCtx(setup.state)
    ctx = injectEscalatedLTDPlay(
      ctx,
      setup.attackerPolityId,
      setup.defenderPolityId,
      setup.provinceDefenderId,
    )
    // override config
    ctx = {
      ...ctx,
      config: { ...ctx.config, conflictResolutionEnabled: false },
    }
    ctx = runConflictResolutionSystem(ctx)
    const play = Object.values(ctx.state.diplomaticPlays)[0]
    // disabled → そのまま (escalated)
    expect(play?.status).toBe('escalated')
  })
})

describe('runConflictResolutionSystem (unsupported kind)', () => {
  it('cancels escalated Plays of unsupported kind (e.g., land_purchase)', () => {
    let s = makeEmptyV016State()
    const provinceAId = 'pr-a' as ProvinceId
    const provinceBId = 'pr-b' as ProvinceId
    const polityAId = 'c-a' as PolityId
    const polityBId = 'c-b' as PolityId
    const houseAId = 'h-a' as HouseId
    const houseBId = 'h-b' as HouseId
    s = withProvince(s, provinceAId, { neighbors: [provinceBId], popGroupIds: [] })
    s = withProvince(s, provinceBId, { neighbors: [provinceAId], popGroupIds: [] })
    s = withHouse(s, houseAId, { seatProvinceId: provinceAId })
    s = withHouse(s, houseBId, { seatProvinceId: provinceBId })
    s = withPolity(s, polityAId, { rank: 2, treasury: 1000, capitalProvinceId: provinceAId })
    s = withPolity(s, polityBId, { rank: 2, treasury: 1000, capitalProvinceId: provinceBId })
    s = bindProvinceToHouseViaPolity(s, provinceAId, polityAId, houseAId)
    s = bindProvinceToHouseViaPolity(s, provinceBId, polityBId, houseBId)

    const playId = 'dp-lp-esc' as DiplomaticPlayId
    // land_purchase は normally escalation 経路を持たないが、test として escalated を強制
    const play: DiplomaticPlay = {
      id: playId,
      kind: 'land_purchase',
      initiator: { kind: 'polity', id: polityAId },
      target: { kind: 'polity', id: polityBId },
      primaryDemand: {
        kind: 'transfer_land_contract',
        provinceId: provinceBId,
        toPolityId: polityAId,
      },
      counterDemand: {
        kind: 'pay_wealth',
        from: { kind: 'polity', id: polityAId },
        to: { kind: 'polity', id: polityBId },
        amount: 500,
      },
      status: 'escalated',
      startedYear: s.currentYear,
      startedMonth: s.currentMonth,
      deadlineYear: s.currentYear + 1,
      deadlineMonth: s.currentMonth,
      progress: 10,
      tension: 70,
    }
    s = { ...s, diplomaticPlays: { [playId]: play } }
    const ctx = makeCtx(s)
    const next = runConflictResolutionSystem(ctx)
    expect(next.state.diplomaticPlays[playId]?.status).toBe('cancelled')
  })
})
