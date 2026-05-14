import { describe, it, expect } from 'vitest'

import {
  createProvinceId,
  createCountryId,
  createHouseId,
  createPersonId,
  createPlotId,
  createEventId,
} from './ids'
import { clamp, clamp100, clamp01 } from '../utils/math'

describe('createProvinceId', () => {
  it('returns the expected string format', () => {
    const id = createProvinceId('p', 0)
    expect(id).toBe('p-0')
  })

  it('same arguments produce same value', () => {
    const a = createProvinceId('p', 42)
    const b = createProvinceId('p', 42)
    expect(a).toBe(b)
  })
})

describe('createCountryId', () => {
  it('returns the expected string format', () => {
    const id = createCountryId('c', 1)
    expect(id).toBe('c-1')
  })
})

describe('createHouseId', () => {
  it('returns the expected string format', () => {
    const id = createHouseId('h', 7)
    expect(id).toBe('h-7')
  })
})

describe('createPersonId', () => {
  it('returns the expected string format', () => {
    const id = createPersonId('pe', 3)
    expect(id).toBe('pe-3')
  })
})

describe('createPlotId', () => {
  it('returns the expected string format', () => {
    const id = createPlotId('plot', 0)
    expect(id).toBe('plot-0')
  })
})

describe('createEventId', () => {
  it('returns the expected string format', () => {
    const id = createEventId('e', 10)
    expect(id).toBe('e-10')
  })
})

describe('ids type safety', () => {
  // Assigning a ProvinceId result to a HouseId variable should be a type error.
  // @ts-expect-error ProvinceId is not assignable to HouseId
  const _typeError: HouseId = createProvinceId('p', 0)
  void _typeError
})

describe('clamp', () => {
  it('clamps value above max to max', () => {
    expect(clamp(150, 0, 100)).toBe(100)
  })

  it('clamps value below min to min', () => {
    expect(clamp(-10, 0, 100)).toBe(0)
  })

  it('returns value unchanged when in range', () => {
    expect(clamp(50, 0, 100)).toBe(50)
  })
})

describe('clamp100', () => {
  it('clamps to 0-100 range', () => {
    expect(clamp100(-50)).toBe(0)
    expect(clamp100(200)).toBe(100)
    expect(clamp100(50)).toBe(50)
  })
})

describe('clamp01', () => {
  it('clamps to 0-1 range', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(0.5)).toBe(0.5)
  })
})
