import type { RngState } from '../rng/rng'
import type { ProvinceId, PolityId } from '../types/ids'
import type { Province } from '../types/province'
import { createPolityId } from '../types/ids'
import { shuffle } from '../rng/rng'

function euclideanDistance(p1: Province, p2: Province): number {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function distributePolities(
  provinces: Province[],
  polityCount: number,
  rng: RngState,
): { assignments: Map<ProvinceId, PolityId>; rng: RngState } {
  const polityIds = Array.from({ length: polityCount }, (_, i) => createPolityId('c', i))

  let seeds: ProvinceId[] | null = null
  // Estimate a reasonable minimum distance between polity seeds based on map extent
  const xs = provinces.map((p) => p.x)
  const ys = provinces.map((p) => p.y)
  const mapExtent = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1,
  )
  const initialMinDist = Math.max(1, Math.floor(mapExtent / (polityCount * 2)))
  let minDist = initialMinDist

  while (!seeds && minDist >= 0) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { value: shuffled, rng: shuffledRng } = shuffle(rng, provinces)
      rng = shuffledRng

      const candidates: ProvinceId[] = []
      for (const p of shuffled) {
        let valid = true
        for (const s of candidates) {
          const sp = provinces.find((pr) => pr.id === s)!
          if (euclideanDistance(sp, p) < minDist) {
            valid = false
            break
          }
        }
        if (valid) {
          candidates.push(p.id)
        }
        if (candidates.length === polityCount) {
          break
        }
      }

      if (candidates.length === polityCount) {
        seeds = candidates
        break
      }
    }

    minDist--
  }

  if (!seeds) {
    seeds = provinces.slice(0, polityCount).map((p) => p.id)
  }

  const assignments = new Map<ProvinceId, PolityId>()
  const polityProvinces = new Map<ProvinceId, ProvinceId>()

  for (let i = 0; i < polityCount; i++) {
    assignments.set(seeds[i]!, polityIds[i]!)
    polityProvinces.set(seeds[i]!, seeds[i]!)
  }

  let round = 0
  while (assignments.size < provinces.length) {
    for (let i = 0; i < polityCount; i++) {
      const polityId = polityIds[i]
      const polityProvs = provinces
        .filter((p) => assignments.get(p.id) === polityId)
        .sort((a, b) => a.id.localeCompare(b.id))

      for (const p of polityProvs) {
        const unassignedNeighbors = p.neighbors
          .filter((nid) => !assignments.has(nid))
          .sort((a, b) => a.localeCompare(b))

        if (unassignedNeighbors.length > 0) {
          const nextId = unassignedNeighbors[0]!
          assignments.set(nextId, polityId!)
        }
      }
    }

    round++
    if (round > 100) {
      break
    }
  }

  return { assignments, rng }
}
