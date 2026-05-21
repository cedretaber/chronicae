import { randomInt } from '../rng/rng'
import type { RngState, RngResult } from '../rng/rng'
import type {
  NameKey,
  NameCultureId,
  NamePoolData,
  NamePoolService,
  PickNameKeyOptions,
} from './namePoolTypes'

const DEFAULT_CULTURE: NameCultureId = 'western'

function getPoolFromData(
  data: NamePoolData,
  category: string,
  culture: NameCultureId,
  path: string[],
): NameKey[] {
  const catData = data[category]
  if (!catData) return []
  const cultureData = catData[culture]
  if (!cultureData) return []
  let current: unknown = cultureData
  for (const segment of path) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return []
    }
  }
  if (Array.isArray(current)) return current as NameKey[]
  return []
}

export function createNamePoolService(data: NamePoolData): NamePoolService {
  return {
    getPool(category: string, culture: NameCultureId, path: string[]): NameKey[] {
      return getPoolFromData(data, category, culture, path)
    },

    pickNameKey(rng: RngState, options: PickNameKeyOptions): RngResult<NameKey> {
      const { nameCultureId, category, path, fallbackPaths } = options

      // Try requested culture + path
      let pool = getPoolFromData(data, category, nameCultureId, path)
      if (pool.length > 0) {
        const { value: idx, rng: nextRng } = randomInt(rng, 0, pool.length - 1)
        return { value: pool[idx]!, rng: nextRng }
      }

      // Try requested culture + fallback paths
      if (fallbackPaths) {
        for (const fp of fallbackPaths) {
          pool = getPoolFromData(data, category, nameCultureId, fp)
          if (pool.length > 0) {
            const { value: idx, rng: nextRng } = randomInt(rng, 0, pool.length - 1)
            return { value: pool[idx]!, rng: nextRng }
          }
        }
      }

      // Try default culture + path
      if (nameCultureId !== DEFAULT_CULTURE) {
        pool = getPoolFromData(data, category, DEFAULT_CULTURE, path)
        if (pool.length > 0) {
          const { value: idx, rng: nextRng } = randomInt(rng, 0, pool.length - 1)
          return { value: pool[idx]!, rng: nextRng }
        }
        if (fallbackPaths) {
          for (const fp of fallbackPaths) {
            pool = getPoolFromData(data, category, DEFAULT_CULTURE, fp)
            if (pool.length > 0) {
              const { value: idx, rng: nextRng } = randomInt(rng, 0, pool.length - 1)
              return { value: pool[idx]!, rng: nextRng }
            }
          }
        }
      }

      // Hardcoded fallback
      return { value: `${category}_0`, rng }
    },

    pickUniqueNameKey(
      rng: RngState,
      used: Set<NameKey>,
      options: PickNameKeyOptions,
      fallbackPrefix: string,
      fallbackIndex: number,
    ): RngResult<NameKey> {
      const { nameCultureId, category, path, fallbackPaths } = options

      const tryPool = (pool: NameKey[]): RngResult<NameKey> | undefined => {
        const available = pool.filter((k) => !used.has(k))
        if (available.length === 0) return undefined
        const { value: idx, rng: nextRng } = randomInt(rng, 0, available.length - 1)
        const key = available[idx]!
        used.add(key)
        return { value: key, rng: nextRng }
      }

      // Try requested culture + path
      let result = tryPool(getPoolFromData(data, category, nameCultureId, path))
      if (result) return result

      // Try fallback paths
      if (fallbackPaths) {
        for (const fp of fallbackPaths) {
          result = tryPool(getPoolFromData(data, category, nameCultureId, fp))
          if (result) return result
        }
      }

      // Try default culture
      if (nameCultureId !== DEFAULT_CULTURE) {
        result = tryPool(getPoolFromData(data, category, DEFAULT_CULTURE, path))
        if (result) return result
        if (fallbackPaths) {
          for (const fp of fallbackPaths) {
            result = tryPool(getPoolFromData(data, category, DEFAULT_CULTURE, fp))
            if (result) return result
          }
        }
      }

      // Hardcoded fallback
      const fallbackKey = `${fallbackPrefix}_${fallbackIndex}`
      used.add(fallbackKey)
      return { value: fallbackKey, rng }
    },
  }
}
