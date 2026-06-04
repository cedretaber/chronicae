import { describe, expect, it } from 'vitest'
import type { TickContext } from './context'
import type { HouseId } from '../types/ids'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { runHouseSurplusDistributionSystem } from './houseSurplusDistributionSystem'
import { createPersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import { createHouseShare } from '../mutations/shareMutations'
import { makeEmptyV016State, withHouse, withPerson } from '../testFixtures'

function makeConfig(
  overrides: Partial<import('../config/defaultConfig').SimulationConfig> = {},
): import('../config/defaultConfig').SimulationConfig {
  return { ...defaultConfig, ...overrides }
}

function makeCtx(
  state: WorldState,
  config?: import('../config/defaultConfig').SimulationConfig,
): TickContext {
  return {
    state,
    rng: createRng('house-surplus-test'),
    config: config || defaultConfig,
    events: [],
    nextEventIndex: 0,
    nextPersonIndex: 0,
    nextHouseIndex: 0,
    nextPolityIndex: 0,
    deathsThisTick: [],
    deathRolesThisTick: {},
  }
}

describe('runHouseSurplusDistributionSystem', () => {
  it('no change when house.wealth <= reserveTarget', () => {
    const houseId = 'dh-0' as HouseId
    let state = makeEmptyV016State()
    state = withHouse(state, houseId, {
      nameKey: 'RichHouse',
      wealth: 50,
      kind: 'normal',
    })

    const ctx = makeCtx(state, makeConfig({ houseWealthReserveTarget: 100 }))
    const result = runHouseSurplusDistributionSystem(ctx)

    expect(result.state.houses[houseId]?.wealth).toBe(50)
  })

  it('no change when house.wealth > reserveTarget but no Person holder Share', () => {
    const houseId = 'dh-0' as HouseId
    let state = makeEmptyV016State()
    state = withHouse(state, houseId, {
      nameKey: 'RichHouse',
      wealth: 200,
      kind: 'normal',
    })

    const ctx = makeCtx(
      state,
      makeConfig({
        houseWealthReserveTarget: 100,
        houseSurplusDistributionMonthlyRate: 0.5,
      }),
    )
    const result = runHouseSurplusDistributionSystem(ctx)

    expect(result.state.houses[houseId]?.wealth).toBe(200)
  })

  it('distributes surplus to Person holders proportionally, remainder to largest', () => {
    const houseId = 'dh-0' as HouseId
    const personAId = createPersonId('pe', 0)
    const personBId = createPersonId('pe', 1)

    let state = makeEmptyV016State()
    state = withHouse(state, houseId, {
      nameKey: 'RichHouse',
      wealth: 200,
      memberIds: [personAId, personBId],
      kind: 'normal',
    })
    state = withPerson(state, personAId, { houseId })
    state = withPerson(state, personBId, { houseId })
    state = createHouseShare(state, houseId, personAId, 60)
    state = createHouseShare(state, houseId, personBId, 40)

    const ctx = makeCtx(
      state,
      makeConfig({
        houseWealthReserveTarget: 100,
        houseSurplusDistributionMonthlyRate: 0.5,
      }),
    )
    const result = runHouseSurplusDistributionSystem(ctx)

    // surplus = 200 - 100 = 100, distributable = floor(100 * 0.5) = 50
    // personA: rawPower=60, personB: rawPower=40, total=100
    // personA portion = floor(60/100 * 50) = floor(30) = 30
    // personB portion = floor(40/100 * 50) = floor(20) = 20
    // remainder = 50 - 30 - 20 = 0
    expect(result.state.persons[personAId]?.wealth).toBe(30)
    expect(result.state.persons[personBId]?.wealth).toBe(20)
    expect(result.state.houses[houseId]?.wealth).toBe(150)
  })

  it('skips AnonymousHouse (kind === system)', () => {
    const anonHouseId = 'dh-anon' as HouseId
    let state = makeEmptyV016State()
    state = withHouse(state, anonHouseId, {
      nameKey: 'Anonymous',
      wealth: 1000,
      kind: 'system',
    })

    const ctx = makeCtx(
      state,
      makeConfig({
        houseWealthReserveTarget: 100,
        houseSurplusDistributionMonthlyRate: 0.5,
      }),
    )
    const result = runHouseSurplusDistributionSystem(ctx)

    expect(result.state.houses[anonHouseId]?.wealth).toBe(1000)
  })

  it('skips inactive house', () => {
    const houseId = 'dh-0' as HouseId
    let state = makeEmptyV016State()
    state = withHouse(state, houseId, {
      nameKey: 'InactiveHouse',
      wealth: 1000,
      active: false,
      kind: 'normal',
    })

    const ctx = makeCtx(
      state,
      makeConfig({
        houseWealthReserveTarget: 100,
        houseSurplusDistributionMonthlyRate: 0.5,
      }),
    )
    const result = runHouseSurplusDistributionSystem(ctx)

    expect(result.state.houses[houseId]?.wealth).toBe(1000)
  })

  it('filters out dead and placeholder Person holders', () => {
    const houseId = 'dh-0' as HouseId
    const alivePersonId = createPersonId('pe', 0)
    const deadPersonId = createPersonId('pe', 1)
    const placeholderPersonId = createPersonId('pe', 2)

    let state = makeEmptyV016State()
    state = withHouse(state, houseId, {
      nameKey: 'TestHouse',
      wealth: 300,
      memberIds: [alivePersonId, deadPersonId, placeholderPersonId],
      kind: 'normal',
    })
    state = withPerson(state, alivePersonId, { houseId, alive: true, kind: 'normal' })
    state = withPerson(state, deadPersonId, { houseId, alive: false, kind: 'normal' })
    state = withPerson(state, placeholderPersonId, { houseId, alive: true, kind: 'placeholder' })
    state = createHouseShare(state, houseId, alivePersonId, 50)
    state = createHouseShare(state, houseId, deadPersonId, 30)
    state = createHouseShare(state, houseId, placeholderPersonId, 20)

    const ctx = makeCtx(
      state,
      makeConfig({
        houseWealthReserveTarget: 100,
        houseSurplusDistributionMonthlyRate: 1.0,
      }),
    )
    const result = runHouseSurplusDistributionSystem(ctx)

    // surplus = 300 - 100 = 200, distributable = 200
    // Only alivePersonId qualifies
    // alive: 200, dead: filtered, placeholder: filtered
    expect(result.state.persons[alivePersonId]?.wealth).toBe(200)
    expect(result.state.persons[deadPersonId]?.wealth).toBe(0)
    expect(result.state.houses[houseId]?.wealth).toBe(100)
  })
})
