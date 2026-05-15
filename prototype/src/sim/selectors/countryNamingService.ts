import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, PersonId, CountryId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import { pickUniqueName, countryNamePool, countryName } from '../worldgen/nameGenerators'

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
      const house = context.rulingHouseId ? state.houses[context.rulingHouseId] : undefined
      return { name: house ? `${house.name}領` : 'Unknown Kingdom', rng }
    }

    case 'province_revolt_independence': {
      const capital = context.capitalProvinceId
        ? state.provinces[context.capitalProvinceId]
        : undefined
      return { name: capital ? `${capital.name}領` : 'Unknown Realm', rng }
    }

    default: {
      const capital = context.capitalProvinceId
        ? state.provinces[context.capitalProvinceId]
        : undefined
      const house = context.rulingHouseId ? state.houses[context.rulingHouseId] : undefined
      const name = capital?.name ?? house?.name ?? 'Unknown'
      return { name, rng }
    }
  }
}
