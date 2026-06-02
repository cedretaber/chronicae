import { describe, it, expect } from 'vitest'
import { computeBounds, computeFocusTransform } from './mapGeometry'

describe('computeBounds', () => {
  it('returns null for empty input', () => {
    expect(computeBounds([])).toBeNull()
  })

  it('returns the point itself for a single point', () => {
    expect(computeBounds([{ x: 3, y: 5 }])).toEqual({ xMin: 3, yMin: 5, xMax: 3, yMax: 5 })
  })

  it('computes axis-aligned bounding box over multiple points', () => {
    expect(
      computeBounds([
        { x: 10, y: -2 },
        { x: -5, y: 8 },
        { x: 3, y: 3 },
      ]),
    ).toEqual({ xMin: -5, yMin: -2, xMax: 10, yMax: 8 })
  })

  it('accepts any iterable (e.g. a generator)', () => {
    function* gen() {
      yield { x: 1, y: 1 }
      yield { x: 4, y: 2 }
    }
    expect(computeBounds(gen())).toEqual({ xMin: 1, yMin: 1, xMax: 4, yMax: 2 })
  })
})

describe('computeFocusTransform', () => {
  it('centers and 85%-fills the target within the viewport', () => {
    // viewBox 0..100 x 0..100, viewport 200x200 -> svgScale = 2, no centering offset.
    const t = computeFocusTransform({
      target: { xMin: 40, yMin: 40, xMax: 60, yMax: 60 },
      viewBounds: [0, 0, 100, 100],
      rectWidth: 200,
      rectHeight: 200,
      pad: 0,
    })
    // target center (50,50) -> element (100,100); placed at viewport center (100,100).
    // bbox 20x20 * svgScale(2)=40 px; scale = min(200/40,200/40)*0.85 = 4.25
    expect(t.scale).toBeCloseTo(4.25, 5)
    expect(t.x).toBeCloseTo(100 - 100 * 4.25, 5)
    expect(t.y).toBeCloseTo(100 - 100 * 4.25, 5)
  })

  it('pad enlarges the considered bbox, lowering the scale', () => {
    const base = computeFocusTransform({
      target: { xMin: 40, yMin: 40, xMax: 60, yMax: 60 },
      viewBounds: [0, 0, 100, 100],
      rectWidth: 200,
      rectHeight: 200,
      pad: 0,
    })
    const padded = computeFocusTransform({
      target: { xMin: 40, yMin: 40, xMax: 60, yMax: 60 },
      viewBounds: [0, 0, 100, 100],
      rectWidth: 200,
      rectHeight: 200,
      pad: 10,
    })
    expect(padded.scale).toBeLessThan(base.scale)
  })
})
