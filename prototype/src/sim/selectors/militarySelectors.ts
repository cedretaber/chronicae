import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HouseId, CountryId } from '../types/ids'
import { clamp } from '../utils/math'
import { normalizedStat } from './personAbilityEffects'
import { getProvinceHouseManpowerBase } from './popEconomySelectors'
import { getHouseLoyaltyToCountry } from './statusSelectors'

export function calcHouseMilitaryPower(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
): number {
  const house = state.houses[houseId]
  if (!house) return 0

  // levyPower: sum of house manpower from all provinces, scaled by houseManpowerPowerFactor
  let levyPower = 0
  for (const pid of house.provinceIds) {
    levyPower += getProvinceHouseManpowerBase(state, config, pid)
  }
  levyPower *= config.houseManpowerPowerFactor

  // mercenaryPower: log1p of available wealth, capped at levyPower * maxMercenaryPowerRatio
  const availableWarWealth = Math.max(0, house.wealth - config.houseMilitaryWealthReserve)
  const rawMercenaryPower = Math.log1p(availableWarWealth) * config.houseWealthMilitaryFactor
  const mercenaryPower = Math.min(rawMercenaryPower, levyPower * config.maxMercenaryPowerRatio)

  // commanderModifier: best martial stat of house members, normalized to -1..1
  const martials = house.memberIds.map((pid) => state.persons[pid]?.stats.martial ?? 0)
  const bestMartial = martials.length > 0 ? Math.max(...martials) : 0
  const commanderModifier = clamp(
    1 + normalizedStat(bestMartial) * config.houseCommanderMartialEffect,
    config.minCommanderModifier,
    config.maxCommanderModifier,
  )

  return (levyPower + mercenaryPower) * commanderModifier
}

export function calcCountryMilitaryPower(
  state: WorldState,
  config: SimulationConfig,
  countryId: CountryId,
): number {
  const country = state.countries[countryId]
  if (!country) return 0

  let total = country.adminPower * config.countryAdminMilitaryFactor

  for (const houseId of country.houseIds) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue

    const housePower = calcHouseMilitaryPower(state, config, houseId)

    if (houseId === country.rulerHouseId) {
      total += housePower
    } else {
      const loyaltyModifier = clamp(
        getHouseLoyaltyToCountry(state, houseId) / 100,
        config.minHouseMilitaryContribution,
        1,
      )
      total += housePower * loyaltyModifier
    }
  }

  return total
}
