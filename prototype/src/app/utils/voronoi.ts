import { Delaunay } from 'd3-delaunay'
import type { ProvinceId, StateRegionId } from '@sim/types/ids'

export type VoronoiInput = {
  id: ProvinceId
  stateId: StateRegionId
  x: number
  y: number
}

export type VoronoiCell = {
  provinceId: ProvinceId
  stateId: StateRegionId
  polygon: [number, number][]
}

export type BorderSegment = [x1: number, y1: number, x2: number, y2: number]

export type VoronoiResult = {
  cells: VoronoiCell[]
  stateBorders: BorderSegment[]
  intraBorders: BorderSegment[]
  bounds: [number, number, number, number]
  centroids: Map<StateRegionId, { cx: number; cy: number }>
}

function edgeKey(x1: number, y1: number, x2: number, y2: number): string {
  const a = `${x1.toFixed(4)},${y1.toFixed(4)}`
  const b = `${x2.toFixed(4)},${y2.toFixed(4)}`
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function computeVoronoi(
  provinces: VoronoiInput[],
  margin = 60,
  excludeStateIds?: Set<string>,
): VoronoiResult {
  if (provinces.length === 0) {
    return {
      cells: [],
      stateBorders: [],
      intraBorders: [],
      bounds: [0, 0, 0, 0],
      centroids: new Map(),
    }
  }

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

  const bounds: [number, number, number, number] = [
    xmin - margin,
    ymin - margin,
    xmax + margin,
    ymax + margin,
  ]

  const points: [number, number][] = provinces.map((p) => [p.x, p.y])
  const delaunay = Delaunay.from(points)
  const voronoi = delaunay.voronoi(bounds)

  const cells: VoronoiCell[] = []
  for (let i = 0; i < provinces.length; i++) {
    const polygon = voronoi.cellPolygon(i)
    if (!polygon) continue
    const prov = provinces[i]!
    if (excludeStateIds?.has(prov.stateId)) continue
    cells.push({
      provinceId: prov.id,
      stateId: prov.stateId,
      polygon: polygon.map(([x, y]) => [x, y] as [number, number]),
    })
  }

  // Build edge→cell mapping for border extraction
  const edgeCells = new Map<string, { stateA: StateRegionId; stateB?: StateRegionId }>()

  for (let i = 0; i < provinces.length; i++) {
    const polygon = voronoi.cellPolygon(i)
    if (!polygon) continue
    const prov = provinces[i]!
    for (let j = 0; j < polygon.length - 1; j++) {
      const [x1, y1] = polygon[j]!
      const [x2, y2] = polygon[j + 1]!
      const key = edgeKey(x1, y1, x2, y2)
      const existing = edgeCells.get(key)
      if (existing) {
        existing.stateB = prov.stateId
      } else {
        edgeCells.set(key, { stateA: prov.stateId })
      }
    }
  }

  const stateBorders: BorderSegment[] = []
  const intraBorders: BorderSegment[] = []

  for (const [key, { stateA, stateB }] of edgeCells) {
    if (!stateB) continue // boundary edge (only one cell)
    if (excludeStateIds?.has(stateA) || excludeStateIds?.has(stateB)) continue
    const parts = key.split('-')
    const [sx1, sy1] = parts[0]!.split(',')
    const [sx2, sy2] = parts[1]!.split(',')
    const seg: BorderSegment = [
      parseFloat(sx1!),
      parseFloat(sy1!),
      parseFloat(sx2!),
      parseFloat(sy2!),
    ]
    if ((stateA as string) !== (stateB as string)) {
      stateBorders.push(seg)
    } else {
      intraBorders.push(seg)
    }
  }

  // Clip border segments to the real province bounding box (with padding)
  if (excludeStateIds && excludeStateIds.size > 0) {
    let rxMin = Infinity
    let ryMin = Infinity
    let rxMax = -Infinity
    let ryMax = -Infinity
    for (const p of provinces) {
      if (excludeStateIds.has(p.stateId)) continue
      if (p.x < rxMin) rxMin = p.x
      if (p.y < ryMin) ryMin = p.y
      if (p.x > rxMax) rxMax = p.x
      if (p.y > ryMax) ryMax = p.y
    }
    const clipPad = margin * 0.8
    const clipBounds = {
      xMin: rxMin - clipPad,
      yMin: ryMin - clipPad,
      xMax: rxMax + clipPad,
      yMax: ryMax + clipPad,
    }

    function clipSegments(segs: BorderSegment[]): BorderSegment[] {
      return segs.filter((s) => {
        const [x1, y1, x2, y2] = s
        const inside1 =
          x1 >= clipBounds.xMin &&
          x1 <= clipBounds.xMax &&
          y1 >= clipBounds.yMin &&
          y1 <= clipBounds.yMax
        const inside2 =
          x2 >= clipBounds.xMin &&
          x2 <= clipBounds.xMax &&
          y2 >= clipBounds.yMin &&
          y2 <= clipBounds.yMax
        return inside1 || inside2
      })
    }

    stateBorders.splice(0, stateBorders.length, ...clipSegments(stateBorders))
    intraBorders.splice(0, intraBorders.length, ...clipSegments(intraBorders))
  }

  // Centroids per state
  const stateAccum = new Map<string, { sx: number; sy: number; count: number }>()
  for (const p of provinces) {
    if (excludeStateIds?.has(p.stateId)) continue
    const key = p.stateId as string
    const acc = stateAccum.get(key)
    if (acc) {
      acc.sx += p.x
      acc.sy += p.y
      acc.count++
    } else {
      stateAccum.set(key, { sx: p.x, sy: p.y, count: 1 })
    }
  }

  const centroids = new Map<StateRegionId, { cx: number; cy: number }>()
  for (const [key, { sx, sy, count }] of stateAccum) {
    centroids.set(key as StateRegionId, { cx: sx / count, cy: sy / count })
  }

  return { cells, stateBorders, intraBorders, bounds, centroids }
}

export function polygonToSvgPath(polygon: [number, number][]): string {
  if (polygon.length === 0) return ''
  const [first, ...rest] = polygon
  if (!first) return ''
  let d = `M${first[0]},${first[1]}`
  for (const [x, y] of rest) {
    d += `L${x},${y}`
  }
  return d + 'Z'
}
