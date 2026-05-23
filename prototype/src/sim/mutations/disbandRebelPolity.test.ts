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
import type { TickContext } from '../tick/context'
import type { WorldState } from '../types/world'
import type {
  HouseId,
  PolityId,
  PersonId,
  ProvinceId,
  PopGroupId,
  OrganizationShareId,
} from '../types/ids'
import { createRebelPolity, disbandRebelPolity } from './worldStructureMutations'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'

function makeCtx(state: WorldState): TickContext {
  return {
    state,
    rng: createRng('disband-test'),
    config: defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 100,
    nextHouseIndex: 100,
    nextPolityIndex: 100,
    deathsThisTick: [],
    deathRolesThisTick: {},
  }
}

function setupWorldWithRebelPolity(): {
  ctx: TickContext
  provinceId: ProvinceId
  oldPolityId: PolityId
  ownerHouseId: HouseId
  ownerLeaderId: PersonId
  rebelPolityId: PolityId
  rebelLeaderId: PersonId
} {
  let s = makeEmptyV016State()
  const provinceId = 'pr-1' as ProvinceId
  const polityId = 'c-1' as PolityId
  const houseId = 'h-1' as HouseId
  const leaderId = 'p-leader' as PersonId
  const popId = 'pg-peasants' as PopGroupId

  s = withProvince(s, provinceId)
  s = withPolity(s, polityId, {
    treasury: 500,
    capitalProvinceId: provinceId,
  })
  s = withHouse(s, houseId, { seatProvinceId: provinceId })
  s = withPerson(s, leaderId, { houseId, age: 35 })
  s = bindProvinceToHouseViaPolity(s, provinceId, polityId, houseId)

  // Add a peasant PopGroup
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
        unrest: 60,
        attitudes: {},
      },
    },
  }

  // Assign house:leader Office to the owner house leader (needed for createRebelPolity 内の
  // 旧 owner house の effective leader 経由の処理)
  const ctxBefore = makeCtx(s)
  // Use createOfficeAssignment via direct state manipulation
  // (test fixture では Office を持つ House を作るために mutation 経由が必要)
  // ここでは spec 確認用に Office を skip し、createRebelPolity の処理が動くかを試す
  void ctxBefore

  const ctx = makeCtx(s)
  const createResult = createRebelPolity(ctx, {
    provinceId,
    rebelClass: 'peasants',
    oldPolityId: polityId,
  })
  if (!createResult.ok) {
    throw new Error(`Failed to create rebel polity: ${createResult.error.message}`)
  }
  return {
    ctx: createResult.value.ctx,
    provinceId,
    oldPolityId: polityId,
    ownerHouseId: houseId,
    ownerLeaderId: leaderId,
    rebelPolityId: createResult.value.value.polityId,
    rebelLeaderId: createResult.value.value.personId,
  }
}

describe('disbandRebelPolity', () => {
  it('settlement: restores LandContract grantee, deactivates Polity, marks leader dead', () => {
    const setup = setupWorldWithRebelPolity()

    // Pre-assertions: Rebel Polity created, owns the Province
    expect(setup.ctx.state.polities[setup.rebelPolityId]?.active).toBe(true)
    expect(getProvinceTerminalPolityId(setup.ctx.state, setup.provinceId)).toBe(setup.rebelPolityId)
    expect(setup.ctx.state.persons[setup.rebelLeaderId]?.alive).toBe(true)

    const result = disbandRebelPolity(setup.ctx, {
      rebelPolityId: setup.rebelPolityId,
      restoreToPolityId: setup.oldPolityId,
      provinceId: setup.provinceId,
      leaderAftermath: 'returned_to_obscurity',
      reason: 'settlement',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = result.value.ctx.state

    // Polity inactive
    expect(after.polities[setup.rebelPolityId]?.active).toBe(false)

    // LandContract grantee restored
    expect(getProvinceTerminalPolityId(after, setup.provinceId)).toBe(setup.oldPolityId)

    // Rebel leader dead
    expect(after.persons[setup.rebelLeaderId]?.alive).toBe(false)

    // No active polity:leader Office for rebel polity
    const orgKey = `polity:${setup.rebelPolityId}`
    const officeIds = after.officeIndex.byOrganization[orgKey] ?? []
    const activeOffices = officeIds.flatMap((id) => {
      const o = after.officeAssignments[id]
      return o && o.active ? [o] : []
    })
    expect(activeOffices.length).toBe(0)

    // No OrganizationShare on rebel polity
    const shareIds = after.shareIndex.byOrganization[orgKey] ?? []
    expect(shareIds.length).toBe(0)

    // REVOLT_SETTLED event fired
    const events = result.value.ctx.events
    expect(events.some((e) => e.type === 'REVOLT_SETTLED')).toBe(true)
  })

  it('suppression: same cleanup but REVOLT_SUPPRESSED event', () => {
    const setup = setupWorldWithRebelPolity()
    const result = disbandRebelPolity(setup.ctx, {
      rebelPolityId: setup.rebelPolityId,
      restoreToPolityId: setup.oldPolityId,
      provinceId: setup.provinceId,
      leaderAftermath: 'executed',
      reason: 'suppression',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const events = result.value.ctx.events
    expect(events.some((e) => e.type === 'REVOLT_SUPPRESSED')).toBe(true)
    expect(events.some((e) => e.type === 'REVOLT_SETTLED')).toBe(false)
  })

  it('returns error if rebelPolity is not commonwealth', () => {
    const setup = setupWorldWithRebelPolity()
    // 既存の oldPolityId は normal (commonwealth ではない) なので disband は拒否されるはず
    const result = disbandRebelPolity(setup.ctx, {
      rebelPolityId: setup.oldPolityId,
      restoreToPolityId: setup.rebelPolityId,
      provinceId: setup.provinceId,
      leaderAftermath: 'returned_to_obscurity',
      reason: 'settlement',
    })
    expect(result.ok).toBe(false)
  })

  it('placeholder bailiff is restored after disband (IntegrityCheck §25 #23)', () => {
    const setup = setupWorldWithRebelPolity()
    const result = disbandRebelPolity(setup.ctx, {
      rebelPolityId: setup.rebelPolityId,
      restoreToPolityId: setup.oldPolityId,
      provinceId: setup.provinceId,
      leaderAftermath: 'exiled',
      reason: 'settlement',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = result.value.ctx.state
    const holdingId = after.provinces[setup.provinceId]!.holdingIds[0]!
    const bailiffId = after.holdingOfficeIndex.byHolding[holdingId]
    expect(bailiffId).toBeDefined()
    if (!bailiffId) return
    const bailiff = after.holdingOfficeAssignments[bailiffId]
    expect(bailiff?.active).toBe(true)
    expect(bailiff?.appointingPolityId).toBe(setup.oldPolityId)
  })
})

// 未使用変数警告回避用 (TypeScript noUnusedLocals)
void (null as unknown as OrganizationShareId | undefined)
