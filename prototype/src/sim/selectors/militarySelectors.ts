import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { HouseId, CountryId } from '../types/ids'
import { clamp } from '../utils/math'
import { normalizedStat } from './personAbilityEffects'
import { getRoleScore } from './abilitySelectors'
import { getProvinceHouseManpowerBase } from './popEconomySelectors'
import { getHouseLoyaltyToCountry } from './statusSelectors'
import { getCountryRulerHouse } from './officeSelectors'

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
  const warScores = house.memberIds
    .filter((pid) => state.persons[pid]?.alive)
    .map((pid) => getRoleScore(state, pid, 'warCommand') / 10)
  const bestWarScore = warScores.length > 0 ? Math.max(...warScores) : 0
  const commanderModifier = clamp(
    1 + normalizedStat(bestWarScore) * config.houseCommanderMartialEffect,
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

  const rulerHouseId = getCountryRulerHouse(state, countryId)

  for (const houseId of country.houseIds) {
    const house = state.houses[houseId]
    if (!house || !house.active) continue

    const housePower = calcHouseMilitaryPower(state, config, houseId)

    if (rulerHouseId && houseId === rulerHouseId) {
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
