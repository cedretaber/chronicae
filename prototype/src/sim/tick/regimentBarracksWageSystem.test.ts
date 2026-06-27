import { describe, it, expect } from 'vitest'
import { makeEmptyV016State, withPolity } from '../testFixtures'
import { createTickContext } from './context'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runRegimentBarracksWageSystem } from './regimentBarracksWageSystem'
import { createRegimentWithBarracksMut } from '../mutations/regimentMutations'
import { addToOrCreatePopGroupMut } from '../mutations/popMutations'
import { getPopStratum } from '../types/popGroup'
import type { WorldState } from '../types/world'
import type { PolityId, HouseId, HoldingId, PopGroupId } from '../types/ids'

const POLITY: PolityId = 'c-1' as PolityId
const HOLDING: HoldingId = 'hl-0' as HoldingId

function makeCtx(state: WorldState) {
  return createTickContext({ state, rng: createRng('wage'), config: defaultConfig })
}

describe('runRegimentBarracksWageSystem', () => {
  it('full pay: treasury >= required → payrollFulfillment = 1, unpaidCount decrements', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, POLITY, { treasury: 1000 })

    const { regiment, barracks } = createRegimentWithBarracksMut(state, {
      owner: { kind: 'polity', id: POLITY },
      sourceKind: 'levy',
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

    // Pre-set unpaidCount = 2 to verify decrement
    state.regimentBarracks[barracks.id] = { ...barracks, unpaidCount: 2 }

    // Add 10 soldiers at wage 0.1 → requiredPayroll = 1.0
    const popId: PopGroupId = addToOrCreatePopGroupMut(state, {
      holdingId: HOLDING,
      class: getPopStratum('soldiers'),
      popType: 'soldiers',
      employerId: { kind: 'barracks', id: barracks.id },
      size: 10,
    })

    const out = runRegimentBarracksWageSystem(makeCtx(state))

    const outBarracks = out.state.regimentBarracks[barracks.id]!
    expect(outBarracks.lastPayrollFulfillment).toBe(1)
    expect(outBarracks.unpaidCount).toBe(1) // max(0, 2 - 1) = 1

    // Treasury reduced by 1.0 (full wage: 10 × 0.1)
    expect(out.state.polities[POLITY]?.treasury).toBeCloseTo(999, 5)

    // POP receives full wage: 10 soldiers × 0.1 = 1.0
    const pop = out.state.popGroups[popId]!
    expect(pop.money).toBeCloseTo(1, 5)

    // Regiment org/morale unchanged (no penalty)
    const outRegiment = out.state.regiments[regiment.id]!
    expect(outRegiment.organization).toBe(80)
    expect(outRegiment.morale).toBe(80)
  })

  it('partial pay: treasury < required → payrollFulfillment < 1, unpaidCount increments, org/morale penalty', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, POLITY, { treasury: 0.5 })

    const { regiment, barracks } = createRegimentWithBarracksMut(state, {
      owner: { kind: 'polity', id: POLITY },
      sourceKind: 'levy',
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

    // 10 soldiers at wage 0.1 → requiredPayroll = 1.0; treasury = 0.5 → paid = 0.5
    const popId: PopGroupId = addToOrCreatePopGroupMut(state, {
      holdingId: HOLDING,
      class: getPopStratum('soldiers'),
      popType: 'soldiers',
      employerId: { kind: 'barracks', id: barracks.id },
      size: 10,
    })

    const out = runRegimentBarracksWageSystem(makeCtx(state))

    const outBarracks = out.state.regimentBarracks[barracks.id]!
    expect(outBarracks.lastPayrollFulfillment).toBeCloseTo(0.5, 5)
    expect(outBarracks.unpaidCount).toBe(1) // 0 + 1

    // Treasury exhausted (0.5 - 0.5 = 0)
    expect(out.state.polities[POLITY]?.treasury).toBeCloseTo(0, 5)

    // POP receives half wages: (1.0/1.0)*0.5 = 0.5
    const pop = out.state.popGroups[popId]!
    expect(pop.money).toBeCloseTo(0.5, 5)

    // Penalty: shortfall=0.5, multiplier=max(1,1)=1
    // orgDamage = 0.5 × 15 × 1 = 7.5 → org: 80 - 7.5 = 72.5
    // moraleDamage = 0.5 × 10 × 1 = 5 → morale: 80 - 5 = 75
    const outRegiment = out.state.regiments[regiment.id]!
    expect(outRegiment.organization).toBeCloseTo(72.5, 5)
    expect(outRegiment.morale).toBeCloseTo(75, 5)
  })

  it('zero required (no barracks POP) → payrollFulfillment = 1, no penalty', () => {
    let state = makeEmptyV016State()
    state = withPolity(state, POLITY, { treasury: 100 })

    const { regiment, barracks } = createRegimentWithBarracksMut(state, {
      owner: { kind: 'polity', id: POLITY },
      sourceKind: 'levy',
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

    // No POPs → requiredPayroll = 0 → payrollFulfillment = 1

    const out = runRegimentBarracksWageSystem(makeCtx(state))

    const outBarracks = out.state.regimentBarracks[barracks.id]!
    expect(outBarracks.lastPayrollFulfillment).toBe(1)
    expect(outBarracks.unpaidCount).toBe(0) // max(0, 0 - 1) = 0

    // Treasury unchanged
    expect(out.state.polities[POLITY]?.treasury).toBe(100)

    // No penalty
    const outRegiment = out.state.regiments[regiment.id]!
    expect(outRegiment.organization).toBe(80)
    expect(outRegiment.morale).toBe(80)
  })

  it('non-polity owner → payrollFulfillment = 0, penalty applied', () => {
    const state = makeEmptyV016State()

    const { regiment, barracks } = createRegimentWithBarracksMut(state, {
      owner: { kind: 'house', id: 'h-1' as HouseId },
      sourceKind: 'noble_retinue',
      troopKind: 'cavalry',
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

    const out = runRegimentBarracksWageSystem(makeCtx(state))

    const outBarracks = out.state.regimentBarracks[barracks.id]!
    expect(outBarracks.lastPayrollFulfillment).toBe(0)
    expect(outBarracks.unpaidCount).toBe(1)

    // Penalty: shortfall=1, multiplier=max(1,1)=1
    // orgDamage = 1 × 15 × 1 = 15 → org: 80 - 15 = 65
    // moraleDamage = 1 × 10 × 1 = 10 → morale: 80 - 10 = 70
    const outRegiment = out.state.regiments[regiment.id]!
    expect(outRegiment.organization).toBeCloseTo(65, 5)
    expect(outRegiment.morale).toBeCloseTo(70, 5)
  })
})
