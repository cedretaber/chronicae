import type { WorldState } from '../types/world'
import type { HouseId, CountryId } from '../types/ids'
import type { Country } from '../types/country'
import { clamp100 } from '../utils/math'
import { moveHouseToCountry } from './moveHouse'

export function createCountryFromHouse(
  state: WorldState,
  rebelHouseId: HouseId,
  newCountryId: CountryId,
): WorldState {
  // Step 1: Look up rebelHouse
  const rebelHouse = state.houses[rebelHouseId]
  if (!rebelHouse) return state

  // Step 2: Look up oldCountry
  const oldCountry = state.countries[rebelHouse.countryId]
  if (!oldCountry) return state

  // Step 3: Build newCountry
  const newCountry: Country = {
    id: newCountryId,
    name: rebelHouse.name + '領',
    rulerHouseId: rebelHouseId,
    houseIds: [rebelHouseId],
    treasury: Math.floor(rebelHouse.wealth * 0.5),
    legitimacy: 45,
    adminPower: 30,
    stability: 40,
    roleAssignments: {},
    active: true,
    capitalProvinceId: rebelHouse.seatProvinceId,
  }

  // Step 4: Add newCountry to state
  const countriesWithNew = { ...state.countries, [newCountryId]: newCountry }
  const stateWithNew = { ...state, countries: countriesWithNew }

  // Step 5: Move house to new country
  const movedState = moveHouseToCountry(stateWithNew, rebelHouseId, newCountryId)

  // Step 6: Re-read old country from moved state
  const updatedOldCountry = movedState.countries[oldCountry.id]
  if (!updatedOldCountry) return movedState

  // Step 7: Apply penalties to old country
  const penalizedOldCountry = {
    ...updatedOldCountry,
    legitimacy: clamp100(updatedOldCountry.legitimacy - 10),
    stability: clamp100(updatedOldCountry.stability - 15),
    adminPower: clamp100(updatedOldCountry.adminPower - 5),
  }

  return {
    ...movedState,
    countries: {
      ...movedState.countries,
      [oldCountry.id]: penalizedOldCountry,
    },
  }
}
