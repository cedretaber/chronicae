import { describe, expect, it } from 'vitest'
import { runPopEmployerReconciliationSystem } from './popEmployerReconciliationSystem'
import { createTickContext } from './context'
import { defaultConfig } from '../config/defaultConfig'
import { createRng } from '../rng/rng'
import { makeEmptyV016State, withProvince } from '../testFixtures'
import {
  createProvinceId,
  createPopGroupId,
  createHoldingImprovementId,
  createRealEstateAssetId,
  createMerchantCompanyEstablishmentId,
} from '../types/ids'
import type { PopGroupId } from '../types/ids'
import type { PopGroup } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { WorkplaceRef } from '../types/workplaceRef'

const PROVINCE = createProvinceId('p', 0)

function makeFixture(
  pops: Array<{ id: PopGroupId; employerId: WorkplaceRef | null; size: number }>,
): {
  state: WorldState
  popIds: PopGroupId[]
} {
  let state = makeEmptyV016State()
  state = withProvince(state, PROVINCE)
  const holdingId = state.provinces[PROVINCE]!.holdingIds[0]!

  const popGroups: Record<PopGroupId, PopGroup> = {}
  for (const p of pops) {
    popGroups[p.id] = {
      id: p.id,
      holdingId,
      class: 'lower',
      popType: 'laborers',
      employerId: p.employerId,
      size: p.size,
      money: 0,
      needSatisfaction: 50,
      unrest: 10,
      attitudes: {},
    }
  }

  state = {
    ...state,
    popGroups,
    popIndex: {
      byHolding: { [holdingId]: pops.map((p) => p.id) },
    },
    nextPopGroupId: pops.length,
  }
  return { state, popIds: pops.map((p) => p.id) }
}

function makeCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('reconcile'), config: defaultConfig })
}

describe('runPopEmployerReconciliationSystem', () => {
  it('dangling improvement 参照を持つ POP を unemployed に切り離す', () => {
    const impId = createHoldingImprovementId(99)
    const popId = createPopGroupId(0)
    const { state } = makeFixture([
      { id: popId, employerId: { kind: 'improvement', id: impId }, size: 50 },
    ])
    // improvement は state に存在しない (dangling)

    const ctx = makeCtx(state)
    const result = runPopEmployerReconciliationSystem(ctx)

    const allPops = Object.values(result.state.popGroups)
    const withEmployer = allPops.filter((p) => p && p.employerId !== null)
    expect(withEmployer).toHaveLength(0)
    // total size は保存される
    const total = allPops.reduce((s, p) => s + (p?.size ?? 0), 0)
    expect(total).toBeCloseTo(50)
  })

  it('dangling realEstateAsset 参照を持つ POP を unemployed に切り離す', () => {
    const assetId = createRealEstateAssetId(99)
    const popId = createPopGroupId(0)
    const { state } = makeFixture([
      { id: popId, employerId: { kind: 'asset', id: assetId }, size: 40 },
    ])
    // asset は state に存在しない

    const ctx = makeCtx(state)
    const result = runPopEmployerReconciliationSystem(ctx)

    const allPops = Object.values(result.state.popGroups)
    const withEmployer = allPops.filter((p) => p && p.employerId !== null)
    expect(withEmployer).toHaveLength(0)
    const total = allPops.reduce((s, p) => s + (p?.size ?? 0), 0)
    expect(total).toBeCloseTo(40)
  })

  it('dangling merchant establishment 参照を持つ POP を unemployed に切り離す', () => {
    const estId = createMerchantCompanyEstablishmentId(99)
    const popId = createPopGroupId(0)
    const { state } = makeFixture([
      { id: popId, employerId: { kind: 'merchant', id: estId }, size: 30 },
    ])

    const ctx = makeCtx(state)
    const result = runPopEmployerReconciliationSystem(ctx)

    const allPops = Object.values(result.state.popGroups)
    const withEmployer = allPops.filter((p) => p && p.employerId !== null)
    expect(withEmployer).toHaveLength(0)
  })

  it('有効な employer を持つ POP には触れない', () => {
    const impId = createHoldingImprovementId(0)
    const popId = createPopGroupId(0)
    const { state } = makeFixture([
      { id: popId, employerId: { kind: 'improvement', id: impId }, size: 50 },
    ])

    // improvement を state に追加 (valid)
    let s = state
    s = {
      ...s,
      holdingImprovements: {
        ...s.holdingImprovements,
        [impId]: {
          id: impId,
          holdingId: s.provinces[PROVINCE]!.holdingIds[0]!,
          kind: 'workshop_infrastructure' as const,
          level: 1,
          condition: 1,
          createdWeek: 1,
        },
      },
    }

    const ctx = makeCtx(s)
    const result = runPopEmployerReconciliationSystem(ctx)

    const pop = result.state.popGroups[popId]
    expect(pop?.employerId).toEqual({ kind: 'improvement', id: impId })
  })

  it('全 POP が unemployed なら ctx を変更せず返す (no-op)', () => {
    const popId = createPopGroupId(0)
    const { state } = makeFixture([{ id: popId, employerId: null, size: 50 }])

    const ctx = makeCtx(state)
    const result = runPopEmployerReconciliationSystem(ctx)

    // 参照同一性 (mutation なし)
    expect(result.state).toBe(ctx.state)
  })
})
