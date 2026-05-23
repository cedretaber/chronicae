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
  HoldingId,
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

    s = withProvince(s, provinceId, {})
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
          holdingId: 'hl-0' as HoldingId,
          class: 'peasants',
          occupation: 'agriculture',
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
        popClass: 'peasants' as const,
        concessionLevel: 'minor',
      },
      status: 'escalated',
      startedWeek: ctx.state.currentYear * 48 + ctx.state.currentWeekOfYear,
      deadlineWeek: (ctx.state.currentYear + 1) * 48 + ctx.state.currentWeekOfYear,
      progress: 30,
      tension: 70,
      initiatorPreparation: 0,
      initiatorLeverage: 0,
      initiatorCommitment: 0,
      targetPreparation: 0,
      targetLeverage: 0,
      targetCommitment: 0,
      initiatorActiveTaskIds: [],
      targetActiveTaskIds: [],
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
        popClass: 'peasants' as const,
        concessionLevel: 'minor',
      },
      status: 'active',
      startedWeek: setup.ctx.state.currentYear * 48 + setup.ctx.state.currentWeekOfYear - 1,
      deadlineWeek: (setup.ctx.state.currentYear + 1) * 48 + setup.ctx.state.currentWeekOfYear - 1,
      progress: 50,
      tension: 30,
      initiatorPreparation: 0,
      initiatorLeverage: 0,
      initiatorCommitment: 0,
      targetPreparation: 0,
      targetLeverage: 0,
      targetCommitment: 0,
      initiatorActiveTaskIds: [],
      targetActiveTaskIds: [],
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

    s = withProvince(s, provinceAttackerId, { neighbors: [provinceDefenderId] })
    s = withProvince(s, provinceDefenderId, { neighbors: [provinceAttackerId] })
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
    const holdingId = ctx.state.provinces[provinceId]?.holdingIds[0]
    if (!holdingId) throw new Error(`No holding in province ${provinceId}`)
    const playId = 'dp-ltd-esc' as DiplomaticPlayId
    const play: DiplomaticPlay = {
      id: playId,
      kind: 'land_claim',
      initiator: { kind: 'polity', id: attackerPolityId },
      target: { kind: 'polity', id: defenderPolityId },
      primaryDemand: {
        kind: 'transfer_land_contract',
        holdingId,
        toPolityId: attackerPolityId,
      },
      status: 'escalated',
      startedWeek: ctx.state.currentYear * 48 + ctx.state.currentWeekOfYear,
      deadlineWeek: (ctx.state.currentYear + 1) * 48 + ctx.state.currentWeekOfYear,
      progress: 10,
      tension: 70,
      initiatorPreparation: 0,
      initiatorLeverage: 0,
      initiatorCommitment: 0,
      targetPreparation: 0,
      targetLeverage: 0,
      targetCommitment: 0,
      initiatorActiveTaskIds: [],
      targetActiveTaskIds: [],
    }
    return {
      ...ctx,
      state: {
        ...ctx.state,
        diplomaticPlays: { ...ctx.state.diplomaticPlays, [playId]: play },
      },
    }
  }

  it('resolves escalated land_claim → status=resolved_by_conflict + WAR_WON/LOST + LAND_CONTRACT_CONQUERED', () => {
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
    const expected = ctx.state.absoluteWeek
    expect(ctx.state.polities[setup.attackerPolityId]?.lastWarWeek).toBe(expected)
    expect(ctx.state.polities[setup.defenderPolityId]?.lastWarWeek).toBe(expected)
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
  it('cancels escalated Plays of unsupported kind (e.g., contract_tax_revision)', () => {
    let s = makeEmptyV016State()
    const provinceAId = 'pr-a' as ProvinceId
    const provinceBId = 'pr-b' as ProvinceId
    const polityAId = 'c-a' as PolityId
    const polityBId = 'c-b' as PolityId
    const houseAId = 'h-a' as HouseId
    const houseBId = 'h-b' as HouseId
    s = withProvince(s, provinceAId, { neighbors: [provinceBId] })
    s = withProvince(s, provinceBId, { neighbors: [provinceAId] })
    s = withHouse(s, houseAId, { seatProvinceId: provinceAId })
    s = withHouse(s, houseBId, { seatProvinceId: provinceBId })
    s = withPolity(s, polityAId, { rank: 2, treasury: 1000, capitalProvinceId: provinceAId })
    s = withPolity(s, polityBId, { rank: 2, treasury: 1000, capitalProvinceId: provinceBId })
    s = bindProvinceToHouseViaPolity(s, provinceAId, polityAId, houseAId)
    s = bindProvinceToHouseViaPolity(s, provinceBId, polityBId, houseBId)

    const playId = 'dp-tax-esc' as DiplomaticPlayId
    // contract_tax_revision は conflictResolutionSystem の対象外 kind (Stage F 時点)
    const play: DiplomaticPlay = {
      id: playId,
      kind: 'contract_tax_revision',
      initiator: { kind: 'polity', id: polityAId },
      target: { kind: 'polity', id: polityBId },
      primaryDemand: {
        kind: 'status_quo',
      },
      status: 'escalated',
      startedWeek: s.currentYear * 48 + s.currentWeekOfYear,
      deadlineWeek: (s.currentYear + 1) * 48 + s.currentWeekOfYear,
      progress: 10,
      tension: 70,
      initiatorPreparation: 0,
      initiatorLeverage: 0,
      initiatorCommitment: 0,
      targetPreparation: 0,
      targetLeverage: 0,
      targetCommitment: 0,
      initiatorActiveTaskIds: [],
      targetActiveTaskIds: [],
    }
    s = { ...s, diplomaticPlays: { [playId]: play } }
    const ctx = makeCtx(s)
    const next = runConflictResolutionSystem(ctx)
    expect(next.state.diplomaticPlays[playId]?.status).toBe('cancelled')
  })
})
