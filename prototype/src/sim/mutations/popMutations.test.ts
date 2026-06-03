import { describe, expect, it } from 'vitest'
import { reduceProvincePopSizeProportional } from './popMutations'
import { makeEmptyV016State, withProvince, withHolding } from '../testFixtures'
import { createProvinceId, createHoldingId, createPopGroupId } from '../types/ids'
import type { ProvinceId, HoldingId, PopGroupId } from '../types/ids'
import type { PopGroup, PopClass } from '../types/popGroup'
import type { WorldState } from '../types/world'

function pop(id: PopGroupId, holdingId: HoldingId, popClass: PopClass, size: number): PopGroup {
  return {
    id,
    holdingId,
    class: popClass,
    occupation: 'agriculture',
    size,
    wealth: 50,
    unrest: 0,
    attitudes: {},
  }
}

// Province with two holdings, each carrying one peasant pop + one townsmen pop.
function makeFixture(): { state: WorldState; provinceId: ProvinceId } {
  const provinceId = createProvinceId('p', 0)
  const h0 = createHoldingId(0)
  const h1 = createHoldingId(1)
  const peas0 = createPopGroupId(0)
  const peas1 = createPopGroupId(1)
  const town0 = createPopGroupId(2)

  let state = makeEmptyV016State()
  state = withProvince(state, provinceId)
  state = withHolding(state, h0, provinceId)
  state = withHolding(state, h1, provinceId)
  state = {
    ...state,
    popGroups: {
      [peas0]: pop(peas0, h0, 'peasants', 100),
      [peas1]: pop(peas1, h1, 'peasants', 200),
      [town0]: pop(town0, h0, 'townsmen', 50),
    },
    popIndex: { byHolding: { [h0]: [peas0, town0], [h1]: [peas1] } },
  }
  return { state, provinceId }
}

describe('reduceProvincePopSizeProportional', () => {
  it('reduces each pop by its OWN proportion (no N× over-application across pops)', () => {
    const { state, provinceId } = makeFixture()
    const result = reduceProvincePopSizeProportional(state, provinceId, 0.1, 'peasants')

    // Each peasant pop loses 10% of ITS size, independent of the other pop's size.
    expect(result.popGroups[createPopGroupId(0)]!.size).toBe(90) // 100 - 100*0.1
    expect(result.popGroups[createPopGroupId(1)]!.size).toBe(180) // 200 - 200*0.1
    // townsmen untouched by the class filter
    expect(result.popGroups[createPopGroupId(2)]!.size).toBe(50)
  })

  it('without a class filter, reduces every pop proportionally', () => {
    const { state, provinceId } = makeFixture()
    const result = reduceProvincePopSizeProportional(state, provinceId, 0.05)

    expect(result.popGroups[createPopGroupId(0)]!.size).toBe(95)
    expect(result.popGroups[createPopGroupId(1)]!.size).toBe(190)
    expect(result.popGroups[createPopGroupId(2)]!.size).toBeCloseTo(47.5)
  })

  it('clamps to >= 0 and is a no-op when rate is 0', () => {
    const { state, provinceId } = makeFixture()
    expect(reduceProvincePopSizeProportional(state, provinceId, 0)).toBe(state)

    const wiped = reduceProvincePopSizeProportional(state, provinceId, 1, 'peasants')
    expect(wiped.popGroups[createPopGroupId(0)]!.size).toBe(0)
    expect(wiped.popGroups[createPopGroupId(1)]!.size).toBe(0)
  })
})
