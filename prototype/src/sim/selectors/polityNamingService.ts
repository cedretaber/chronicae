import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, PersonId, PolityId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { NamePoolService } from '../namegen/namePoolTypes'
import { pickUniqueName, polityNamePool, polityName } from '../worldgen/nameGenerators'

export type PolityNameOrigin =
  | 'worldgen'
  | 'house_independence'
  | 'province_revolt_independence'
  | 'rebellion_independence'
  | 'future_split'
  | 'future_release'

export type PolityNameContext = {
  origin: PolityNameOrigin
  provinceIds?: ProvinceId[]
  capitalProvinceId?: ProvinceId
  rulingHouseId?: HouseId
  founderPersonId?: PersonId
  sourcePolityId?: PolityId
  rebelClass?: PopClass
}

function buildUsedNameKeys(state: WorldState): Set<string> {
  return new Set(
    Object.values(state.polities)
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map((c) => c.nameKey),
  )
}

export function generatePolityNameKey(
  state: WorldState,
  _config: SimulationConfig,
  rng: RngState,
  _context: PolityNameContext,
  namePoolService?: NamePoolService,
): { nameKey: string; rng: RngState } {
  const usedKeys = buildUsedNameKeys(state)

  if (namePoolService) {
    const { value: key, rng: nextRng } = namePoolService.pickUniqueNameKey(
      rng,
      usedKeys,
      {
        nameCultureId: 'western',
        category: 'polity',
        path: ['default'],
      },
      'polity',
      Object.keys(state.polities).length,
    )
    return { nameKey: key, rng: nextRng }
  }

  // Fallback without namePoolService: use legacy pool
  const pool = polityNamePool()
  const available = pool.filter((n) => !usedKeys.has(n))
  if (available.length > 0) {
    const { name, rng: nextRng } = pickUniqueName(
      pool,
      usedKeys,
      polityName,
      Object.keys(state.polities).length,
      rng,
    )
    return { nameKey: name, rng: nextRng }
  }
  return { nameKey: polityName(Object.keys(state.polities).length), rng }
}
