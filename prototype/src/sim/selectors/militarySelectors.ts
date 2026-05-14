import type { WorldState } from '../types/world'
import type { HouseId, CountryId } from '../types/ids'
import { getEffectiveProvinceManpower } from './developmentSelectors'

export function calcHouseMilitaryPower(state: WorldState, houseId: HouseId): number {
  const house = state.houses[houseId]
  if (!house) return 0
  const provinceManpower = house.provinceIds.reduce((sum, pId) => {
    const province = state.provinces[pId]
    return sum + (province ? getEffectiveProvinceManpower(province) : 0)
  }, 0)
  const martials = house.memberIds.map((pid) => state.persons[pid]?.stats.martial ?? 0)
  const bestMartial = martials.length > 0 ? Math.max(...martials) : 0
  return provinceManpower + bestMartial * 2 + house.wealth / 20
}

export function calcCountryMilitaryPower(state: WorldState, countryId: CountryId): number {
  const country = state.countries[countryId]
  if (!country) return 0
  let total = country.adminPower * 0.3
  for (const houseId of country.houseIds) {
    total += calcHouseMilitaryPower(state, houseId)
  }
  return total
}
