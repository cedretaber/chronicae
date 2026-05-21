import type { RngState } from '../rng/rng'
import { randomFloat } from '../rng/rng'

export type Point2D = { x: number; y: number }

export function poissonDiskSample(
  rng: RngState,
  width: number,
  height: number,
  count: number,
  minDistance: number,
  maxAttempts: number,
): { points: Point2D[]; rng: RngState } {
  let dist = minDistance
  let points: Point2D[] = []

  for (let retry = 0; retry < 10; retry++) {
    const result = bridsonSample(rng, width, height, dist, maxAttempts)
    rng = result.rng
    if (result.points.length >= count) {
      points = result.points.slice(0, count)
      return { points, rng }
    }
    dist *= 0.9
  }

  // Fallback: use whatever we got, pad with random points
  points = [...points]
  while (points.length < count) {
    const { value: rx, rng: r1 } = randomFloat(rng)
    const { value: ry, rng: r2 } = randomFloat(r1)
    rng = r2
    points.push({ x: rx * width, y: ry * height })
  }
  return { points: points.slice(0, count), rng }
}

function bridsonSample(
  rng: RngState,
  width: number,
  height: number,
  minDist: number,
  maxAttempts: number,
): { points: Point2D[]; rng: RngState } {
  const cellSize = minDist / Math.SQRT2
  const gridW = Math.ceil(width / cellSize)
  const gridH = Math.ceil(height / cellSize)
  const grid: (number | null)[] = new Array<number | null>(gridW * gridH).fill(null)
  const points: Point2D[] = []
  const active: number[] = []

  function gridIndex(x: number, y: number): number {
    return Math.floor(y / cellSize) * gridW + Math.floor(x / cellSize)
  }

  function isValidPoint(px: number, py: number): boolean {
    if (px < 0 || px >= width || py < 0 || py >= height) return false
    const gx = Math.floor(px / cellSize)
    const gy = Math.floor(py / cellSize)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx
        const ny = gy + dy
        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue
        const idx = grid[ny * gridW + nx]
        if (idx === null || idx === undefined) continue
        const other = points[idx]
        if (!other) continue
        const ddx = other.x - px
        const ddy = other.y - py
        if (ddx * ddx + ddy * ddy < minDist * minDist) return false
      }
    }
    return true
  }

  // First point
  const { value: startX, rng: r1 } = randomFloat(rng)
  const { value: startY, rng: r2 } = randomFloat(r1)
  rng = r2
  const p0: Point2D = { x: startX * width, y: startY * height }
  points.push(p0)
  grid[gridIndex(p0.x, p0.y)] = 0
  active.push(0)

  while (active.length > 0) {
    const activeIdx = active.length - 1
    const pointIdx = active[activeIdx]!
    const origin = points[pointIdx]!
    let found = false

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { value: angleRand, rng: ra } = randomFloat(rng)
      const { value: radiusRand, rng: rr } = randomFloat(ra)
      rng = rr

      const angle = angleRand * 2 * Math.PI
      const radius = minDist + radiusRand * minDist
      const nx = origin.x + radius * Math.cos(angle)
      const ny = origin.y + radius * Math.sin(angle)

      if (isValidPoint(nx, ny)) {
        const newIdx = points.length
        points.push({ x: nx, y: ny })
        grid[gridIndex(nx, ny)] = newIdx
        active.push(newIdx)
        found = true
        break
      }
    }

    if (!found) {
      active.splice(activeIdx, 1)
    }
  }

  return { points, rng }
}
