import type { ProvinceId, StateRegionId } from '@sim/types/ids'
import type { VoronoiInput } from './voronoi'

export const OCEAN_STATE_ID = '__ocean__' as StateRegionId

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function computeConvexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return [...points]
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  function cross(
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  }

  const lower: { x: number; y: number }[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: { x: number; y: number }[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function isInsideConvexHull(
  hull: { x: number; y: number }[],
  px: number,
  py: number,
  padding: number,
): boolean {
  if (hull.length < 3) return false
  // Check distance to each hull edge; if inside all edges (with padding), return true
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!
    const b = hull[(i + 1) % hull.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const cross = dx * (py - a.y) - dy * (px - a.x)
    // Point is on the right side of the edge (outside) if cross < -padding * edgeLen
    const edgeLen = Math.sqrt(dx * dx + dy * dy)
    if (cross < -padding * edgeLen) return false
  }
  return true
}

export function addOceanPoints(
  provinces: VoronoiInput[],
  spacing = 30,
): { allPoints: VoronoiInput[]; oceanIds: Set<string> } {
  if (provinces.length === 0) return { allPoints: [], oceanIds: new Set() }

  const hull = computeConvexHull(provinces)

  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (const p of provinces) {
    if (p.x < xmin) xmin = p.x
    if (p.y < ymin) ymin = p.y
    if (p.x > xmax) xmax = p.x
    if (p.y > ymax) ymax = p.y
  }

  const oceanPoints: VoronoiInput[] = []
  const oceanIds = new Set<string>()
  let idx = 0

  function addOcean(x: number, y: number): void {
    const id = `__ocean_${idx}__` as ProvinceId
    oceanIds.add(id)
    oceanPoints.push({ id, stateId: OCEAN_STATE_ID, x, y })
    idx++
  }

  const outerMargin = 160
  const hullPadding = 5
  const gridLeft = xmin - outerMargin
  const gridTop = ymin - outerMargin
  const gridRight = xmax + outerMargin
  const gridBottom = ymax + outerMargin

  for (let gx = gridLeft; gx <= gridRight; gx += spacing) {
    for (let gy = gridTop; gy <= gridBottom; gy += spacing) {
      const jx = (pseudoRandom(idx * 3 + 1) - 0.5) * spacing * 0.7
      const jy = (pseudoRandom(idx * 3 + 2) - 0.5) * spacing * 0.7
      const px = gx + jx
      const py = gy + jy

      if (!isInsideConvexHull(hull, px, py, hullPadding)) {
        addOcean(px, py)
      }
    }
  }

  return { allPoints: [...provinces, ...oceanPoints], oceanIds }
}
