import type { ProvinceId, PopGroupId } from '../types/ids'
import type { Province } from '../types/province'
import type { RngState } from '../rng/rng'
import type { MapGenerationConfig } from './mapConfig'
import { createProvinceId } from '../types/ids'
import { pickUniqueName, provinceName, provinceNamePool } from './nameGenerators'
import { randomFloat, shuffle } from '../rng/rng'

const COLS = 8
const ROWS = 5

function isConnected(adj: Map<ProvinceId, Set<ProvinceId>>, allIds: ProvinceId[]): boolean {
  if (allIds.length === 0) return true
  const start = allIds[0]
  if (!start) return true
  const visited = new Set<ProvinceId>()
  const queue: ProvinceId[] = [start]
  visited.add(start)
  while (queue.length > 0) {
    const cur = queue.shift()!
    const neighbors = adj.get(cur)
    if (!neighbors) continue
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb)
        queue.push(nb)
      }
    }
  }
  return visited.size === allIds.length
}

export function generateProvinces(
  rng: RngState,
  mapConfig: MapGenerationConfig,
): { provinces: Province[]; rng: RngState } {
  const provinces: Province[] = []
  const usedNames = new Set<string>()
  const pool = provinceNamePool()
  let currentRng = rng

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col
      const id = createProvinceId('p', index)

      const neighbors: ProvinceId[] = []

      if (col > 0) {
        neighbors.push(createProvinceId('p', index - 1))
      }
      if (col < COLS - 1) {
        neighbors.push(createProvinceId('p', index + 1))
      }
      if (row > 0) {
        neighbors.push(createProvinceId('p', index - COLS))
      }
      if (row < ROWS - 1) {
        neighbors.push(createProvinceId('p', index + COLS))
      }

      const { name, rng: nextRng } = pickUniqueName(
        pool,
        usedNames,
        provinceName,
        index,
        currentRng,
      )
      currentRng = nextRng

      provinces.push({
        id,
        name,
        x: col * 100,
        y: row * 100,
        neighbors,
        habitability: 0,
        development: 0,
        polityControl: 0,
        popGroupIds: [] as PopGroupId[],
      })
    }
  }

  // Step 2: Link removal
  if (mapConfig.linkRemovalEnabled) {
    const adj = new Map<ProvinceId, Set<ProvinceId>>()
    for (const p of provinces) {
      adj.set(p.id, new Set(p.neighbors))
    }

    const allIds = provinces.map((p) => p.id)

    const edges: [ProvinceId, ProvinceId][] = []
    for (const p of provinces) {
      for (const nid of p.neighbors) {
        if (p.id < nid) edges.push([p.id, nid])
      }
    }

    const { value: shuffledEdges, rng: rng1 } = shuffle(currentRng, edges)
    currentRng = rng1

    for (const [a, b] of shuffledEdges) {
      // Check if average degree is already at target
      const totalDegree = provinces.reduce((sum, p) => sum + p.neighbors.length, 0)
      const avgDegree = totalDegree / provinces.length
      if (avgDegree < mapConfig.targetAverageDegreeMin) break

      // Attempt removal
      const adjA = adj.get(a)
      const adjB = adj.get(b)
      if (!adjA || !adjB) continue

      // Remove edge
      adjA.delete(b)
      adjB.delete(a)

      // Check constraints
      const minDegreeOk = provinces.every((p) => (adj.get(p.id)?.size ?? 0) >= mapConfig.minDegree)
      if (!minDegreeOk) {
        adjA.add(b)
        adjB.add(a)
        continue
      }

      const deadEndCount = provinces.filter((p) => (adj.get(p.id)?.size ?? 0) === 1).length
      if (deadEndCount > mapConfig.maxDeadEnds) {
        adjA.add(b)
        adjB.add(a)
        continue
      }

      if (!isConnected(adj, allIds)) {
        adjA.add(b)
        adjB.add(a)
        continue
      }

      const newTotalDegree = provinces.reduce((sum, p) => sum + (adj.get(p.id)?.size ?? 0), 0)
      const newAvgDegree = newTotalDegree / provinces.length
      if (newAvgDegree < mapConfig.targetAverageDegreeMin) {
        adjA.add(b)
        adjB.add(a)
        continue
      }

      // All constraints passed — keep removal
    }

    for (const p of provinces) {
      const nbSet = adj.get(p.id)
      p.neighbors = nbSet ? Array.from(nbSet) : []
    }
  }

  // Step 3: Jitter
  if (mapConfig.jitterEnabled) {
    const CELL_WIDTH = 100
    const CELL_HEIGHT = 100
    const jitterX = CELL_WIDTH * mapConfig.jitterRatioX
    const jitterY = CELL_HEIGHT * mapConfig.jitterRatioY

    for (const p of provinces) {
      const { value: rx, rng: rngX } = randomFloat(currentRng)
      currentRng = rngX
      const { value: ry, rng: rngY } = randomFloat(currentRng)
      currentRng = rngY
      p.x += rx * 2 * jitterX - jitterX
      p.y += ry * 2 * jitterY - jitterY
    }
  }

  return { provinces, rng: currentRng }
}
