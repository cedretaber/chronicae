import { describe, it, expect } from 'vitest'
import { makeEmptyV016State } from '../testFixtures'
import { createRng } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { createTickContext } from './context'
import { runConflictResolutionSystem } from './conflictResolutionSystem'

describe('runConflictResolutionSystem', () => {
  it('v0.39: system is no-op', () => {
    const s = makeEmptyV016State()
    const ctx = createTickContext({ state: s, rng: createRng('noop'), config: defaultConfig })
    const next = runConflictResolutionSystem(ctx)
    expect(next).toBe(ctx)
  })
})
