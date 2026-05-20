import type { RngState } from '../rng/rng'
import type { ProvinceId, PolityId } from '../types/ids'
import type { Province } from '../types/province'
import { createPolityId } from '../types/ids'
import { shuffle } from '../rng/rng'

function manhattanDistance(p1: Province, p2: Province): number {
  return Math.abs(p1.x - p2.x) / 100 + Math.abs(p1.y - p2.y) / 100
}

export function distributePolities(
  provinces: Province[],
  polityCount: number,
  rng: RngState,
): { assignments: Map<ProvinceId, PolityId>; rng: RngState } {
  const polityIds = Array.from({ length: polityCount }, (_, i) => createPolityId('c', i))

  let seeds: ProvinceId[] | null = null
  const initialMinDist = Math.max(1, Math.floor(Math.sqrt(provinces.length) / polityCount))
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
          if (manhattanDistance(sp, p) < minDist) {
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
