import { describe, it, expect } from 'vitest'
import { getProvinceDevelopmentMultiplier } from './developmentSelectors'

describe('getProvinceDevelopmentMultiplier', () => {
  it('returns 0 when development = -100', () => {
    expect(getProvinceDevelopmentMultiplier(-100)).toBe(0)
  })

  it('returns 1 when development = 0', () => {
    expect(getProvinceDevelopmentMultiplier(0)).toBe(1)
  })

  it('returns 2 when development = 100', () => {
    expect(getProvinceDevelopmentMultiplier(100)).toBe(2)
  })

  it('clamps to 0 when development = -200', () => {
    expect(getProvinceDevelopmentMultiplier(-200)).toBe(0)
  })

  it('clamps to 2 when development = 200', () => {
    expect(getProvinceDevelopmentMultiplier(200)).toBe(2)
  })
})
