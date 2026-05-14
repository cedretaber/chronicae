import { describe, it, expect } from 'vitest'
import {
  getProvinceDevelopmentMultiplier,
  getEffectiveProvinceTax,
  getEffectiveProvinceManpower,
} from './developmentSelectors'
import type { Province } from '../types/province'

function makeProvince(overrides: Partial<Province>): Province {
  return {
    id: 'p-0' as Province['id'],
    name: 'Test',
    x: 0,
    y: 0,
    neighbors: [],
    ownerHouseId: 'h-0' as Province['ownerHouseId'],
    countryId: 'c-0' as Province['countryId'],
    baseTax: 5,
    manpower: 4,
    unrest: 0,
    development: 0,
    countryControl: 0,
    houseControl: 0,
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

describe('getEffectiveProvinceTax', () => {
  it('returns baseTax when unrest=0 and development=0', () => {
    expect(
      getEffectiveProvinceTax(makeProvince({ baseTax: 5, unrest: 0, development: 0 })),
    ).toBeCloseTo(5)
  })

  it('returns 0 when development=-100 (multiplier=0)', () => {
    expect(getEffectiveProvinceTax(makeProvince({ baseTax: 5, development: -100 }))).toBeCloseTo(0)
  })

  it('returns baseTax * 2 when development=100', () => {
    expect(getEffectiveProvinceTax(makeProvince({ baseTax: 5, development: 100 }))).toBeCloseTo(10)
  })

  it('returns baseTax * 0.5 when unrest=50', () => {
    expect(getEffectiveProvinceTax(makeProvince({ baseTax: 5, unrest: 50 }))).toBeCloseTo(2.5)
  })
})

describe('getEffectiveProvinceManpower', () => {
  it('returns manpower when unrest=0 and development=0', () => {
    expect(
      getEffectiveProvinceManpower(makeProvince({ manpower: 4, unrest: 0, development: 0 })),
    ).toBeCloseTo(4)
  })

  it('returns 0 when development=-100', () => {
    expect(
      getEffectiveProvinceManpower(makeProvince({ manpower: 4, development: -100 })),
    ).toBeCloseTo(0)
  })

  it('returns manpower * 2 when development=100', () => {
    expect(
      getEffectiveProvinceManpower(makeProvince({ manpower: 4, development: 100 })),
    ).toBeCloseTo(8)
  })

  it('returns manpower * 0.5 when unrest=100', () => {
    expect(getEffectiveProvinceManpower(makeProvince({ manpower: 4, unrest: 100 }))).toBeCloseTo(2)
  })
})
