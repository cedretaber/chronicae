import { describe, it, expect } from 'vitest'
import { poissonDiskSample } from './poissonDisk'
import { createRng } from '../rng/rng'

describe('poissonDiskSample', () => {
  it('produces the requested number of points', () => {
    const rng = createRng('test-seed')
    const { points } = poissonDiskSample(rng, 1000, 700, 9, 160, 30)
    expect(points).toHaveLength(9)
  })

  it('points are within bounds', () => {
    const rng = createRng('bounds-test')
    const { points } = poissonDiskSample(rng, 500, 400, 6, 100, 30)
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(500)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThan(400)
    }
  })

  it('is deterministic with same seed', () => {
    const rng1 = createRng('determinism')
    const rng2 = createRng('determinism')
    const { points: p1 } = poissonDiskSample(rng1, 800, 600, 5, 120, 30)
    const { points: p2 } = poissonDiskSample(rng2, 800, 600, 5, 120, 30)
    expect(p1).toEqual(p2)
  })

  it('maintains minimum distance between points', () => {
    const rng = createRng('min-dist')
    const minDist = 100
    const { points } = poissonDiskSample(rng, 1000, 700, 8, minDist, 30)
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!
        const b = points[j]!
        const dx = a.x - b.x
        const dy = a.y - b.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        expect(dist).toBeGreaterThanOrEqual(minDist * 0.85)
      }
    }
  })
})
