import { describe, it, expect } from 'vitest'
import { computeProjectMaterialBaseUnits } from './projectMaterialSelectors'
import { makeEmptyV016State } from '../testFixtures'
import { defaultConfig } from '../config/defaultConfig'
import { RESOURCE_PRICE_DEFINITIONS } from '../config/resourceEconomyDefinitions'
import type { Project } from '../types/project'
import type { WorldState } from '../types/world'

describe('computeProjectMaterialBaseUnits — margin 除算 (v0.55 予算 regression 修正)', () => {
  it('basePrice 換算した per-advance 総額が required/(expectedTasks×margin) に一致する', () => {
    const state: WorldState = makeEmptyV016State()
    const required = 140
    const targetProgress = 200
    const project = {
      kind: 'develop_real_estate',
      realEstateKind: 'farm',
      budget: {
        required,
        allocated: required,
        remaining: required,
        spent: 0,
        source: { kind: 'owner' },
      },
      targetProgress,
    } as unknown as Project

    const baseUnits = computeProjectMaterialBaseUnits(state, defaultConfig, project)
    const totalAtBase = baseUnits.reduce(
      (sum, u) => sum + u.baseUnits * RESOURCE_PRICE_DEFINITIONS[u.resource].basePrice,
      0,
    )

    const expectedTasks = Math.ceil(targetProgress / defaultConfig.projectAdvanceProgressSuccess)
    const expected = required / (expectedTasks * defaultConfig.projectBudgetMarginMultiplier)

    // 均衡価格 (smoothed=base) では 1 advance あたり消費 = perAdvanceCost = required/(tasks×margin)。
    // margin で割らないバグ版だと required/expectedTasks (margin 倍) になっていた。
    expect(totalAtBase).toBeCloseTo(expected, 6)
    expect(totalAtBase).toBeCloseTo(
      required / expectedTasks / defaultConfig.projectBudgetMarginMultiplier,
      6,
    )
  })
})
