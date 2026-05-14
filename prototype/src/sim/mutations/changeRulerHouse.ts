import type { CountryId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'
import { clamp100 } from '../utils/math'

export function changeRulerHouse(
  state: WorldState,
  countryId: CountryId,
  newRulerHouseId: HouseId,
): WorldState {
  const country = state.countries[countryId]
  if (!country) throw new Error('Country not found')

  const oldRulerHouse = state.houses[country.rulerHouseId]
  if (!oldRulerHouse) throw new Error('Old ruler house not found')

  const newRulerHouse = state.houses[newRulerHouseId]
  if (!newRulerHouse) throw new Error('New ruler house not found')

  const newHouses = { ...state.houses }
  newHouses[oldRulerHouse.id] = {
    ...oldRulerHouse,
    prestige: clamp100(oldRulerHouse.prestige - 25),
    loyaltyToCountry: clamp100(oldRulerHouse.loyaltyToCountry - 20),
  }
  newHouses[newRulerHouse.id] = {
    ...newRulerHouse,
    prestige: clamp100(newRulerHouse.prestige + 20),
  }

  const newCountries = { ...state.countries }
  newCountries[countryId] = {
    ...country,
    rulerHouseId: newRulerHouseId,
    legitimacy: clamp100(country.legitimacy - 15),
    stability: clamp100(country.stability - 20),
    roleAssignments: {},
  }

  return {
    ...state,
    houses: newHouses,
    countries: newCountries,
  }
}
