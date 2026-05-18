import { describe, it, expect } from 'vitest'
import { getProvinceDevelopmentMultiplier } from './developmentSelectors'
import type { Province } from '../types/province'

function makeProvince(overrides: Partial<Province>): Province {
  return {
    id: 'p-0' as Province['id'],
    name: 'Test',
    x: 0,
    y: 0,
    neighbors: [],
    habitability: 50,
    popGroupIds: [],
    development: 0,
    polityControl: 0,
    ...overrides,
  }
}

describe('getProvinceDevelopmentMultiplier', () => {
  it('returns 0 when development = -100', () => {
    expect(getProvinceDevelopmentMultiplier(makeProvince({ development: -100 }))).toBe(0)
  })

  it('returns 1 when development = 0', () => {
    expect(getProvinceDevelopmentMultiplier(makeProvince({ development: 0 }))).toBe(1)
  })

  it('returns 2 when development = 100', () => {
    expect(getProvinceDevelopmentMultiplier(makeProvince({ development: 100 }))).toBe(2)
  })

  it('clamps to 0 when development = -200', () => {
    expect(getProvinceDevelopmentMultiplier(makeProvince({ development: -200 }))).toBe(0)
  })

  it('clamps to 2 when development = 200', () => {
    expect(getProvinceDevelopmentMultiplier(makeProvince({ development: 200 }))).toBe(2)
  })
})
