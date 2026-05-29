import { Delaunay } from 'd3-delaunay'
import type { StateRegionId } from '../types/ids'
import type { Province, ProvinceTerrain, ProvinceFeature } from '../types/province'
import type { RngState } from '../rng/rng'
import type { MapGenerationConfig } from './mapConfig'
import type { WorldPreset } from './worldPresets'
import { createProvinceId, createStateRegionId } from '../types/ids'
import { pickUniqueName, provinceName, provinceNamePool } from './nameGenerators'
import { randomFloat, randomInt } from '../rng/rng'
import { defaultConfig } from '../config/defaultConfig'
import { poissonDiskSample } from './poissonDisk'
import { kruskalMST } from './mst'
import { UnionFind } from './unionFind'
import type { NamePoolService } from '../namegen/namePoolTypes'

type StateCenter = { id: StateRegionId; x: number; y: number }
type ProvincePoint = { index: number; stateIndex: number; x: number; y: number }

const TERRAIN_KEYS: readonly ProvinceTerrain[] = [
  'plains',
  'forest',
  'hills',
  'mountains',
  'wetlands',
]

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** terrain weights から決定的に 1 種抽選する（randomFloat を 1 回消費）。 */
function pickTerrain(
  rng: RngState,
  weights: Record<ProvinceTerrain, number>,
): { value: ProvinceTerrain; rng: RngState } {
  let total = 0
  for (const k of TERRAIN_KEYS) total += weights[k]
  const { value: roll, rng: nextRng } = randomFloat(rng)
  let threshold = roll * total
  for (const k of TERRAIN_KEYS) {
    threshold -= weights[k]
    if (threshold < 0) return { value: k, rng: nextRng }
  }
  return { value: TERRAIN_KEYS[TERRAIN_KEYS.length - 1]!, rng: nextRng }
}

export function generateProvinces(
  rng: RngState,
  mapConfig: MapGenerationConfig,
  preset: WorldPreset,
  namePoolService?: NamePoolService,
): {
  provinces: Province[]
  stateCenters: StateCenter[]
  rng: RngState
} {
  // Step 1: Place state centers via Poisson disk
  const { points: centerPoints, rng: rng1 } = poissonDiskSample(
    rng,
    mapConfig.worldMapWidth,
    mapConfig.worldMapHeight,
    preset.stateCount,
    mapConfig.minStateCenterDistance,
    mapConfig.mapGenerationMaxAttempts,
  )
  rng = rng1

  const stateCenters: StateCenter[] = centerPoints.map((p, i) => ({
    id: createStateRegionId(i),
    x: p.x,
    y: p.y,
  }))

  // Step 2: Province count per state
  const provinceCounts: number[] = []
  for (let i = 0; i < preset.stateCount; i++) {
    const { value, rng: r } = randomInt(
      rng,
      preset.provinceCountPerStateMin,
      preset.provinceCountPerStateMax,
    )
    provinceCounts.push(value)
    rng = r
  }

  // Step 3: Elliptical cluster params per state
  const clusterParams: { radiusX: number; radiusY: number; rotation: number }[] = []
  for (let i = 0; i < preset.stateCount; i++) {
    const { value: rv, rng: r1 } = randomFloat(rng)
    const radiusX =
      mapConfig.stateRadiusMin + rv * (mapConfig.stateRadiusMax - mapConfig.stateRadiusMin)
    const { value: av, rng: r2 } = randomFloat(r1)
    const aspect =
      mapConfig.stateAspectRatioMin +
      av * (mapConfig.stateAspectRatioMax - mapConfig.stateAspectRatioMin)
    const { value: rotV, rng: r3 } = randomFloat(r2)
    const rotation = rotV * Math.PI
    clusterParams.push({ radiusX, radiusY: radiusX * aspect, rotation })
    rng = r3
  }

  // Step 4: Place province points around state centers
  const allPoints: ProvincePoint[] = []
  // Spatial hash for min distance check
  const cellSize = mapConfig.minProvinceDistance
  const spatialGrid = new Map<string, ProvincePoint[]>()

  function gridKey(x: number, y: number): string {
    return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`
  }

  function isTooClose(x: number, y: number): boolean {
    const gx = Math.floor(x / cellSize)
    const gy = Math.floor(y / cellSize)
    const minDistSq = mapConfig.minProvinceDistance * mapConfig.minProvinceDistance
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const key = `${gx + dx},${gy + dy}`
        const cell = spatialGrid.get(key)
        if (!cell) continue
        for (const pt of cell) {
          const ddx = pt.x - x
          const ddy = pt.y - y
          if (ddx * ddx + ddy * ddy < minDistSq) return true
        }
      }
    }
    return false
  }

  function addToGrid(pt: ProvincePoint): void {
    const key = gridKey(pt.x, pt.y)
    const cell = spatialGrid.get(key)
    if (cell) {
      cell.push(pt)
    } else {
      spatialGrid.set(key, [pt])
    }
  }

  let globalIndex = 0

  for (let si = 0; si < preset.stateCount; si++) {
    const center = stateCenters[si]!
    const count = provinceCounts[si]!
    const cluster = clusterParams[si]!
    const cosR = Math.cos(cluster.rotation)
    const sinR = Math.sin(cluster.rotation)

    for (let pi = 0; pi < count; pi++) {
      let placed = false
      for (let attempt = 0; attempt < mapConfig.mapGenerationMaxAttempts; attempt++) {
        const { value: angleV, rng: ra } = randomFloat(rng)
        const { value: radiusV, rng: rr } = randomFloat(ra)
        rng = rr

        const angle = angleV * 2 * Math.PI
        const r = Math.sqrt(radiusV)
        const lx = r * Math.cos(angle) * cluster.radiusX
        const ly = r * Math.sin(angle) * cluster.radiusY
        const x = center.x + lx * cosR - ly * sinR
        const y = center.y + lx * sinR + ly * cosR

        const cx = Math.max(0, Math.min(mapConfig.worldMapWidth, x))
        const cy = Math.max(0, Math.min(mapConfig.worldMapHeight, y))

        if (!isTooClose(cx, cy)) {
          const pt: ProvincePoint = { index: globalIndex, stateIndex: si, x: cx, y: cy }
          allPoints.push(pt)
          addToGrid(pt)
          globalIndex++
          placed = true
          break
        }
      }

      if (!placed) {
        // Fallback: place near center with small random offset
        const { value: fx, rng: rf1 } = randomFloat(rng)
        const { value: fy, rng: rf2 } = randomFloat(rf1)
        rng = rf2
        const cx = Math.max(0, Math.min(mapConfig.worldMapWidth, center.x + (fx - 0.5) * 20))
        const cy = Math.max(0, Math.min(mapConfig.worldMapHeight, center.y + (fy - 0.5) * 20))
        const pt: ProvincePoint = { index: globalIndex, stateIndex: si, x: cx, y: cy }
        allPoints.push(pt)
        addToGrid(pt)
        globalIndex++
      }
    }
  }

  // Step 5: Geometric state assignment validation
  // Reassign if nearest state center differs from assigned state
  const stateCountTracker = new Map<number, number>()
  for (const pt of allPoints) {
    stateCountTracker.set(pt.stateIndex, (stateCountTracker.get(pt.stateIndex) ?? 0) + 1)
  }

  for (const pt of allPoints) {
    let nearestSi = pt.stateIndex
    let nearestDistSq = Infinity
    for (let si = 0; si < stateCenters.length; si++) {
      const c = stateCenters[si]!
      const dx = pt.x - c.x
      const dy = pt.y - c.y
      const dsq = dx * dx + dy * dy
      if (dsq < nearestDistSq) {
        nearestDistSq = dsq
        nearestSi = si
      }
    }
    if (nearestSi !== pt.stateIndex) {
      const oldCount = stateCountTracker.get(pt.stateIndex) ?? 0
      if (oldCount > preset.provinceCountPerStateMin) {
        stateCountTracker.set(pt.stateIndex, oldCount - 1)
        stateCountTracker.set(nearestSi, (stateCountTracker.get(nearestSi) ?? 0) + 1)
        pt.stateIndex = nearestSi
      }
    }
  }

  // Step 6: Delaunay triangulation
  const points: [number, number][] = allPoints.map((p) => [p.x, p.y])
  const delaunay = Delaunay.from(points)

  // Extract all Delaunay edges
  type EdgePair = { a: number; b: number; dist: number }
  const edgeSet = new Set<string>()
  const allEdges: EdgePair[] = []

  for (let i = 0; i < allPoints.length; i++) {
    for (const j of delaunay.neighbors(i)) {
      if (i >= j) continue
      const key = `${i}-${j}`
      if (edgeSet.has(key)) continue
      edgeSet.add(key)
      const ptA = allPoints[i]!
      const ptB = allPoints[j]!
      const dx = ptA.x - ptB.x
      const dy = ptA.y - ptB.y
      allEdges.push({ a: i, b: j, dist: Math.sqrt(dx * dx + dy * dy) })
    }
  }

  // Step 7: Classify edges
  const intraEdges: EdgePair[] = []
  const interEdges: EdgePair[] = []
  for (const edge of allEdges) {
    const sA = allPoints[edge.a]!.stateIndex
    const sB = allPoints[edge.b]!.stateIndex
    if (sA === sB) {
      intraEdges.push(edge)
    } else {
      interEdges.push(edge)
    }
  }

  // Step 8: MST per state for intra-state connectivity
  const acceptedEdges = new Set<string>()
  const degree = new Array<number>(allPoints.length).fill(0)

  function acceptEdge(a: number, b: number): void {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (acceptedEdges.has(key)) return
    acceptedEdges.add(key)
    degree[a]!++
    degree[b]!++
  }

  // Group provinces by state, build local MST
  const stateProvinces = new Map<number, number[]>()
  for (const pt of allPoints) {
    const arr = stateProvinces.get(pt.stateIndex)
    if (arr) arr.push(pt.index)
    else stateProvinces.set(pt.stateIndex, [pt.index])
  }

  for (const [si, provIndices] of stateProvinces) {
    if (provIndices.length <= 1) continue
    const localIndexMap = new Map<number, number>()
    for (let li = 0; li < provIndices.length; li++) {
      localIndexMap.set(provIndices[li]!, li)
    }

    const localEdges = intraEdges
      .filter((e) => allPoints[e.a]!.stateIndex === si)
      .map((e) => ({
        a: localIndexMap.get(e.a)!,
        b: localIndexMap.get(e.b)!,
        weight: e.dist,
      }))

    const mstEdges = kruskalMST(provIndices.length, localEdges)
    for (const me of mstEdges) {
      acceptEdge(provIndices[me.a]!, provIndices[me.b]!)
    }
  }

  // Step 9: Extra intra-state edges
  const sortedIntra = [...intraEdges].sort((a, b) => {
    if (a.a !== b.a) return a.a - b.a
    return a.b - b.b
  })

  for (const edge of sortedIntra) {
    const key = `${edge.a}-${edge.b}`
    if (acceptedEdges.has(key)) continue
    if (degree[edge.a]! >= mapConfig.maxProvinceDegree) continue
    if (degree[edge.b]! >= mapConfig.maxProvinceDegree) continue

    const { value: roll, rng: r } = randomFloat(rng)
    rng = r
    if (roll < mapConfig.intraStateExtraEdgeChance) {
      acceptEdge(edge.a, edge.b)
    }
  }

  // Step 10: Inter-state edges
  const sortedInter = [...interEdges].sort((a, b) => a.dist - b.dist)
  const statePairEdgeCount = new Map<string, number>()

  function statePairKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`
  }

  // First pass: guarantee at least one edge per adjacent state pair
  for (const edge of sortedInter) {
    const sA = allPoints[edge.a]!.stateIndex
    const sB = allPoints[edge.b]!.stateIndex
    const spKey = statePairKey(sA, sB)
    if ((statePairEdgeCount.get(spKey) ?? 0) > 0) continue
    if (degree[edge.a]! >= mapConfig.maxProvinceDegree) continue
    if (degree[edge.b]! >= mapConfig.maxProvinceDegree) continue
    acceptEdge(edge.a, edge.b)
    statePairEdgeCount.set(spKey, 1)
  }

  // Second pass: probabilistic extra inter-state edges
  for (const edge of sortedInter) {
    const key = `${edge.a}-${edge.b}`
    if (acceptedEdges.has(key)) continue
    if (degree[edge.a]! >= mapConfig.maxProvinceDegree) continue
    if (degree[edge.b]! >= mapConfig.maxProvinceDegree) continue

    const sA = allPoints[edge.a]!.stateIndex
    const sB = allPoints[edge.b]!.stateIndex
    const spKey = statePairKey(sA, sB)
    if ((statePairEdgeCount.get(spKey) ?? 0) >= mapConfig.maxInterStateEdgesPerStatePair) continue

    const { value: roll, rng: r } = randomFloat(rng)
    rng = r
    if (roll < mapConfig.interStateExtraEdgeChance) {
      acceptEdge(edge.a, edge.b)
      statePairEdgeCount.set(spKey, (statePairEdgeCount.get(spKey) ?? 0) + 1)
    }
  }

  // Step 11: Global connectivity guarantee
  const uf = new UnionFind(allPoints.length)
  for (const edgeKey of acceptedEdges) {
    const [aStr, bStr] = edgeKey.split('-')
    uf.union(parseInt(aStr!, 10), parseInt(bStr!, 10))
  }

  if (uf.componentCount() > 1) {
    // Sort all Delaunay edges by distance, try to connect components
    const allByDist = [...allEdges].sort((a, b) => a.dist - b.dist)
    for (const edge of allByDist) {
      if (uf.componentCount() <= 1) break
      if (!uf.connected(edge.a, edge.b)) {
        acceptEdge(edge.a, edge.b)
        uf.union(edge.a, edge.b)
      }
    }
  }

  // Step 12: Build Province objects with neighbors
  const neighborMap = new Map<number, number[]>()
  for (const edgeKey of acceptedEdges) {
    const [aStr, bStr] = edgeKey.split('-')
    const a = parseInt(aStr!, 10)
    const b = parseInt(bStr!, 10)
    const na = neighborMap.get(a)
    if (na) na.push(b)
    else neighborMap.set(a, [b])
    const nb = neighborMap.get(b)
    if (nb) nb.push(a)
    else neighborMap.set(b, [a])
  }

  // Step 13: Name provinces and build final array
  const usedNameKeys = new Set<string>()
  const pool = provinceNamePool()
  const provinces: Province[] = []
  // StateRegion ごとの dominantTerrain を lazy fill する（allPoints 走査順は決定的）
  const dominantTerrainByState = new Map<number, ProvinceTerrain>()

  for (const pt of allPoints) {
    const id = createProvinceId('p', pt.index)
    const stateId = createStateRegionId(pt.stateIndex)
    const neighbors = (neighborMap.get(pt.index) ?? []).map((ni) => createProvinceId('p', ni))

    let pNameKey: string
    if (namePoolService) {
      const { value: key, rng: nr } = namePoolService.pickUniqueNameKey(
        rng,
        usedNameKeys,
        {
          nameCultureId: 'western',
          category: 'province',
          path: ['common'],
        },
        'province',
        pt.index,
      )
      rng = nr
      pNameKey = key
    } else {
      const { name, rng: nr } = pickUniqueName(pool, usedNameKeys, provinceName, pt.index, rng)
      rng = nr
      pNameKey = name
    }

    // terrain: state の dominantTerrain を高確率で継承し、残りは weights から抽選
    let dominantTerrain = dominantTerrainByState.get(pt.stateIndex)
    if (dominantTerrain === undefined) {
      const picked = pickTerrain(rng, defaultConfig.provinceTerrainWeights)
      rng = picked.rng
      dominantTerrain = picked.value
      dominantTerrainByState.set(pt.stateIndex, dominantTerrain)
    }
    let terrain: ProvinceTerrain
    {
      const { value: inheritRoll, rng: r1 } = randomFloat(rng)
      rng = r1
      if (inheritRoll < defaultConfig.stateRegionDominantTerrainInheritanceChance) {
        terrain = dominantTerrain
      } else {
        const picked = pickTerrain(rng, defaultConfig.provinceTerrainWeights)
        rng = picked.rng
        terrain = picked.value
      }
    }

    // features: coastal → major_river → lake の順で判定（§10.2 消費順を固定）
    const features: ProvinceFeature[] = []
    const marginX = mapConfig.worldMapWidth * defaultConfig.provinceCoastalEdgeMarginRatio
    const marginY = mapConfig.worldMapHeight * defaultConfig.provinceCoastalEdgeMarginRatio
    const nearEdge =
      pt.x < marginX ||
      pt.x > mapConfig.worldMapWidth - marginX ||
      pt.y < marginY ||
      pt.y > mapConfig.worldMapHeight - marginY
    if (nearEdge) {
      // 内陸 Province では coastal の draw を消費しない
      const { value: roll, rng: r1 } = randomFloat(rng)
      rng = r1
      if (roll < defaultConfig.provinceFeatureCoastalChance) features.push('coastal')
    }
    {
      const chance = clamp01(
        defaultConfig.provinceFeatureMajorRiverBaseChance +
          (defaultConfig.provinceFeatureMajorRiverTerrainDelta[terrain] ?? 0),
      )
      const { value: roll, rng: r1 } = randomFloat(rng)
      rng = r1
      if (roll < chance) features.push('major_river')
    }
    {
      const chance = clamp01(
        defaultConfig.provinceFeatureLakeBaseChance +
          (defaultConfig.provinceFeatureLakeTerrainDelta[terrain] ?? 0),
      )
      const { value: roll, rng: r1 } = randomFloat(rng)
      rng = r1
      if (roll < chance) features.push('lake')
    }

    const provinceObj: Province = {
      id,
      stateId,
      nameKey: pNameKey,
      x: pt.x,
      y: pt.y,
      neighbors,
      terrain,
      features,
      holdingIds: [],
    }
    provinces.push(provinceObj)
  }

  return { provinces, stateCenters, rng }
}
