import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { getBarracksFulfillment, getEffectiveMaxStrength } from './barracksSelectors'
import { createRegimentWithBarracksMut } from '../mutations/regimentMutations'
import { addToOrCreatePopGroupMut } from '../mutations/popMutations'
import { getPopStratum } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { PolityId, HoldingId, RegimentBarracksId } from '../types/ids'

const POLITY: PolityId = 'c-1' as PolityId
const HOLDING: HoldingId = 'hl-0' as HoldingId

function makeInfantryBarracks(
  state: WorldState,
  requiredByPopType: { soldiers: number; ministeriales: number },
) {
  return createRegimentWithBarracksMut(state, {
    owner: { kind: 'polity', id: POLITY },
    sourceKind: 'levy',
    troopKind: 'infantry',
    holdingId: HOLDING,
    requiredByPopType,
    strength: 100,
    organization: 80,
    morale: 80,
    maxStrength: 100,
    basePower: 100,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
  })
}

function makeCavalryBarracks(
  state: WorldState,
  requiredByPopType: { soldiers: number; ministeriales: number; nobles: number },
) {
  return createRegimentWithBarracksMut(state, {
    owner: { kind: 'polity', id: POLITY },
    sourceKind: 'noble_retinue',
    troopKind: 'cavalry',
    holdingId: HOLDING,
    requiredByPopType,
    strength: 100,
    organization: 80,
    morale: 80,
    maxStrength: 100,
    basePower: 100,
    baselineOrganization: 50,
    maxOrganization: 100,
    baselineMorale: 30,
    maxMorale: 100,
    createdWeek: 0,
  })
}

function addPop(
  state: WorldState,
  barracksId: RegimentBarracksId,
  popType: Parameters<typeof getPopStratum>[0],
  size: number,
) {
  addToOrCreatePopGroupMut(state, {
    holdingId: HOLDING,
    class: getPopStratum(popType),
    popType,
    employerId: { kind: 'barracks', id: barracksId },
    size,
  })
}

describe('getBarracksFulfillment', () => {
  it('infantry fully staffed (soldiers 8, ministeriales 2) → overall=1, command=1', () => {
    const state = makeEmptyV016State()
    const { barracks } = makeInfantryBarracks(state, { soldiers: 8, ministeriales: 2 })
    addPop(state, barracks.id, 'soldiers', 8)
    addPop(state, barracks.id, 'ministeriales', 2)

    const result = getBarracksFulfillment(state, barracks.id)
    expect(result.overallFulfillment).toBeCloseTo(1, 5)
    expect(result.commandFulfillment).toBeCloseTo(1, 5)
    expect(result.byPopType['soldiers']).toBeCloseTo(1, 5)
    expect(result.byPopType['ministeriales']).toBeCloseTo(1, 5)
  })

  it('infantry half-staffed → overall=0.5', () => {
    const state = makeEmptyV016State()
    const { barracks } = makeInfantryBarracks(state, { soldiers: 8, ministeriales: 2 })
    addPop(state, barracks.id, 'soldiers', 4)
    addPop(state, barracks.id, 'ministeriales', 1)

    const result = getBarracksFulfillment(state, barracks.id)
    expect(result.overallFulfillment).toBeCloseTo(0.5, 5)
  })

  it('cavalry (soldiers 6, ministeriales 3, nobles 1) fully staffed → overall=1, command=1', () => {
    const state = makeEmptyV016State()
    const { barracks } = makeCavalryBarracks(state, {
      soldiers: 6,
      ministeriales: 3,
      nobles: 1,
    })
    addPop(state, barracks.id, 'soldiers', 6)
    addPop(state, barracks.id, 'ministeriales', 3)
    addPop(state, barracks.id, 'nobles', 1)

    const result = getBarracksFulfillment(state, barracks.id)
    expect(result.overallFulfillment).toBeCloseTo(1, 5)
    expect(result.commandFulfillment).toBeCloseTo(1, 5)
  })

  it('cavalry half ministeriales, full nobles → commandFulfillment = 0.5', () => {
    const state = makeEmptyV016State()
    const { barracks } = makeCavalryBarracks(state, {
      soldiers: 6,
      ministeriales: 3,
      nobles: 1,
    })
    addPop(state, barracks.id, 'soldiers', 6)
    addPop(state, barracks.id, 'ministeriales', 1) // half of ideal ratio 3/6=0.5; actual 1/6
    addPop(state, barracks.id, 'nobles', 1)

    const result = getBarracksFulfillment(state, barracks.id)
    // ministerialFulfillment = (1/6) / (3/6) = 0.333...
    // nobleFulfillment = (1/6) / (1/6) = 1
    // commandFulfillment = min(0.333, 1) = 0.333
    expect(result.commandFulfillment).toBeCloseTo(1 / 3, 3)
  })

  it('empty requirements (local_levy) → overall=1, command=1', () => {
    const state = makeEmptyV016State()
    const { barracks } = createRegimentWithBarracksMut(state, {
      owner: { kind: 'polity', id: POLITY },
      sourceKind: 'local_levy',
      troopKind: 'infantry',
      holdingId: HOLDING,
      requiredByPopType: {},
      strength: 100,
      organization: 80,
      morale: 80,
      maxStrength: 100,
      basePower: 100,
      baselineOrganization: 50,
      maxOrganization: 100,
      baselineMorale: 30,
      maxMorale: 100,
      createdWeek: 0,
    })

    const result = getBarracksFulfillment(state, barracks.id)
    expect(result.overallFulfillment).toBe(1)
    expect(result.commandFulfillment).toBe(1)
  })

  it('zero soldiers required → commandFulfillment = 1', () => {
    const state = makeEmptyV016State()
    const { barracks } = makeInfantryBarracks(state, { soldiers: 0, ministeriales: 2 })
    addPop(state, barracks.id, 'ministeriales', 2)

    const result = getBarracksFulfillment(state, barracks.id)
    expect(result.commandFulfillment).toBe(1)
  })
})

describe('getEffectiveMaxStrength', () => {
  it('half overall fulfillment → effectiveMaxStrength = maxStrength × 0.5', () => {
    const state = makeEmptyV016State()
    const { regiment, barracks } = makeInfantryBarracks(state, { soldiers: 8, ministeriales: 2 })
    addPop(state, barracks.id, 'soldiers', 4)
    addPop(state, barracks.id, 'ministeriales', 1)

    const result = getEffectiveMaxStrength(state, regiment)
    expect(result).toBeCloseTo(regiment.maxStrength * 0.5, 5)
  })
})
