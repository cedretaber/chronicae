import { describe, it, expect } from 'vitest'
import { createRng, randomFloat, randomInt, chooseOne, shuffle } from './rng'

describe('rng', () => {
  it('createRng called twice produces the same sequence via randomFloat', () => {
    const rng1 = createRng('test')
    const rng2 = createRng('test')

    const result1A = randomFloat(rng1)
    const result2A = randomFloat(rng2)
    expect(result1A.value).toBe(result2A.value)

    const result1B = randomFloat(result1A.rng)
    const result2B = randomFloat(result2A.rng)
    expect(result1B.value).toBe(result2B.value)
  })

  it('randomFloat always returns value in [0, 1)', () => {
    const rng = createRng('float-range-test')
    let current = rng
    for (let i = 0; i < 1000; i++) {
      const { value, rng: next } = randomFloat(current)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      current = next
    }
  })

  it('randomInt(rng, 5, 5) always returns 5', () => {
    const rng = createRng('int-single-range')
    let current = rng
    for (let i = 0; i < 100; i++) {
      const { value, rng: next } = randomInt(current, 5, 5)
      expect(value).toBe(5)
      current = next
    }
  })

  it('randomInt always returns value in [min, max]', () => {
    const rng = createRng('int-range-test')
    let current = rng
    for (let i = 0; i < 1000; i++) {
      const { value, rng: next } = randomInt(current, 3, 10)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(10)
      current = next
    }
  })

  it('shuffle with same seed produces same order', () => {
    const rng1 = createRng('shuffle-determinism')
    const rng2 = createRng('shuffle-determinism')

    const result1 = shuffle(rng1, [1, 2, 3, 4, 5])
    const result2 = shuffle(rng2, [1, 2, 3, 4, 5])

    expect(result1.value).toEqual(result2.value)
  })

  it('shuffle result has same elements as input', () => {
    const rng = createRng('shuffle-elements-test')
    const input = [10, 20, 30, 40, 50]
    const { value } = shuffle(rng, input)

    expect(value).toHaveLength(input.length)
    for (const item of input) {
      expect(value).toContain(item)
    }
  })

  it('chooseOne throws on empty array', () => {
    const rng = createRng('choose-empty')
    expect(() => chooseOne(rng, [])).toThrow('Cannot choose from an empty array')
  })

  it('chooseOne with single-element array always returns that element', () => {
    const rng = createRng('choose-single')
    let current = rng
    const single = ['only']
    for (let i = 0; i < 100; i++) {
      const { value, rng: next } = chooseOne(current, single)
      expect(value).toBe('only')
      current = next
    }
  })
})
