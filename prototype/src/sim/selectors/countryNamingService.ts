import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, PersonId, CountryId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import { pickUniqueName, countryNamePool, countryName } from '../worldgen/nameGenerators'

const ROMAN_NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']

function ensureUniqueName(
  baseName: string,
  usedNames: Set<string>,
  rng: RngState,
): { name: string; rng: RngState } {
  if (!usedNames.has(baseName)) {
    return { name: baseName, rng }
  }
  for (let i = 0; i < ROMAN_NUMERALS.length; i++) {
    const candidate = `${baseName} ${ROMAN_NUMERALS[i]}`
    if (!usedNames.has(candidate)) {
      return { name: candidate, rng }
    }
  }
  // Fallback to worldgen pool after 10 attempts
  const pool = countryNamePool()
  const fallbackIndex = Math.floor(Math.random() * pool.length)
  return pickUniqueName(pool, usedNames, countryName, fallbackIndex, rng)
}

function buildUsedNames(state: WorldState): Set<string> {
  return new Set(
    Object.values(state.countries)
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map((c) => c.name),
  )
}

export type CountryNameOrigin =
  | 'worldgen'
  | 'house_independence'
  | 'province_revolt_independence'
  | 'rebellion_independence'
  | 'future_split'
  | 'future_release'

export type CountryNameContext = {
  origin: CountryNameOrigin
  provinceIds?: ProvinceId[]
  capitalProvinceId?: ProvinceId
  rulingHouseId?: HouseId
  founderPersonId?: PersonId
  sourceCountryId?: CountryId
  rebelClass?: PopClass
}

export function generateCountryName(
  state: WorldState,
  _config: SimulationConfig,
  rng: RngState,
  context: CountryNameContext,
): { name: string; rng: RngState } {
  switch (context.origin) {
    case 'worldgen': {
      const usedNames = new Set(
        Object.values(state.countries)
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
          .map((c) => c.name),
      )
      const { name, rng: nextRng } = pickUniqueName(
        countryNamePool(),
        usedNames,
        countryName,
        Object.keys(state.countries).length,
        rng,
      )
      return { name, rng: nextRng }
    }

    case 'house_independence':
    case 'rebellion_independence': {
      const usedNames = buildUsedNames(state)
      const house = context.rulingHouseId ? state.houses[context.rulingHouseId] : undefined
      const baseName = house ? `${house.name}領` : 'Unknown Kingdom'
      return ensureUniqueName(baseName, usedNames, rng)
    }

    case 'province_revolt_independence': {
      const usedNames = buildUsedNames(state)
      const capital = context.capitalProvinceId
        ? state.provinces[context.capitalProvinceId]
        : undefined
      const baseName = capital ? `${capital.name}領` : 'Unknown Realm'
      return ensureUniqueName(baseName, usedNames, rng)
    }

    default: {
      const usedNames = buildUsedNames(state)
      const capital = context.capitalProvinceId
        ? state.provinces[context.capitalProvinceId]
        : undefined
      const house = context.rulingHouseId ? state.houses[context.rulingHouseId] : undefined
      const name = capital?.name ?? house?.name ?? 'Unknown'
      return ensureUniqueName(name, usedNames, rng)
    }
  }
}
