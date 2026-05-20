import { describe, it, expect } from 'vitest'
import { tick } from './tick'
import { generateWorld } from '../worldgen/generateWorld'
import { defaultConfig } from '../config/defaultConfig'

describe('tick', () => {
  it('tick advances month by 1', () => {
    const { world, rng } = generateWorld('tick-month-test')
    const input = { state: world, rng, config: defaultConfig }

    const result = tick(input)

    expect(result.state.currentWeekOfYear).toBe(world.currentWeekOfYear + 1)
    expect(result.state.absoluteWeek).toBe(world.absoluteWeek + 1)
    expect(result.state.currentYear).toBe(world.currentYear)
  })

  it('tick is deterministic: same input produces identical output (JSON.stringify)', () => {
    const { world, rng } = generateWorld('tick-determinism')
    const input1 = { state: world, rng: { ...rng }, config: defaultConfig }
    const input2 = { state: world, rng: { ...rng }, config: defaultConfig }

    const result1 = tick(input1)
    const result2 = tick(input2)

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
  })

  it('tick returns valid TickResult shape (state, rng, events)', () => {
    const { world, rng } = generateWorld('tick-shape-test')
    const input = { state: world, rng, config: defaultConfig }

    const result = tick(input)

    expect(result.state).toBeDefined()
    expect(result.state.currentYear).toBeDefined()
    expect(result.state.currentWeekOfYear).toBeDefined()
    expect(result.state.provinces).toBeDefined()
    expect(result.state.polities).toBeDefined()
    expect(result.state.houses).toBeDefined()
    expect(result.state.persons).toBeDefined()
    expect(result.state.activePlots).toBeDefined()
    expect(result.rng).toBeDefined()
    expect(result.rng.seedText).toBeDefined()
    expect(result.rng.state).toBeDefined()
    expect(Array.isArray(result.events)).toBe(true)
  })

  it('52 consecutive ticks advance year by 1 (week 1 -> week 1, year 2)', () => {
    const { world, rng } = generateWorld('tick-year-test')
    let currentState = world
    let currentRng = { ...rng }
    const config = defaultConfig

    for (let i = 0; i < 52; i++) {
      const input = { state: currentState, rng: currentRng, config }
      const result = tick(input)
      currentState = result.state
      currentRng = result.rng
    }

    expect(currentState.currentYear).toBe(world.currentYear + 1)
    expect(currentState.currentWeekOfYear).toBe(world.currentWeekOfYear)
  })

  it('tick on generateWorld output does not throw (integration test)', () => {
    const { world, rng } = generateWorld('tick-integration')
    const input = { state: world, rng, config: defaultConfig }

    expect(() => tick(input)).not.toThrow()
  })

  it('tick events array contains only SimEvent objects with required fields', () => {
    const { world, rng } = generateWorld('tick-events-test')
    const input = { state: world, rng, config: defaultConfig }

    const result = tick(input)

    for (const event of result.events) {
      expect(event.id).toBeDefined()
      expect(typeof event.id).toBe('string')
      expect(event.year).toBeDefined()
      expect(event.weekOfYear).toBeDefined()
      expect(event.type).toBeDefined()
      expect(['minor', 'normal', 'major', 'critical']).toContain(event.importance)
      expect(Array.isArray(event.actorIds)).toBe(true)
      expect(Array.isArray(event.houseIds)).toBe(true)
      expect(Array.isArray(event.polityIds)).toBe(true)
      expect(Array.isArray(event.provinceIds)).toBe(true)
      expect(typeof event.summary).toBe('string')
      expect(Array.isArray(event.reasons)).toBe(true)
      expect(Array.isArray(event.effects)).toBe(true)
    }
  })
})
