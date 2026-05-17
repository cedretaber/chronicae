import type { WorldState } from '../types/world'
import type { HouseId, CountryId, ProvinceId } from '../types/ids'
import type { Country } from '../types/country'
import { clamp } from '../utils/math'
import { moveHouseToCountry } from './moveHouse'
import { createOfficeAssignment } from './officeMutations'
import { getHouseLeader } from '../selectors/officeSelectors'

export function createCountryFromHouse(
  state: WorldState,
  rebelHouseId: HouseId,
  newCountryId: CountryId,
  name?: string,
): WorldState {
  // Step 1: Look up rebelHouse
  const rebelHouse = state.houses[rebelHouseId]
  if (!rebelHouse) return state

  // Step 2: Look up oldCountry
  const oldCountry = state.countries[rebelHouse.countryId]
  if (!oldCountry) return state

  // Use provided name or fallback to default
  const countryName = name ?? rebelHouse.name + '領'

  // Step 3: Build newCountry
  const newCountry: Country = {
    id: newCountryId,
    name: countryName,
    houseIds: [rebelHouseId],
    treasury: Math.floor(rebelHouse.wealth * 0.5),
    legacyPrestige: 20,
    adminPower: 0,
    active: true,
    capitalProvinceId: rebelHouse.seatProvinceId,
  }

  // Step 4: Add newCountry to state
  const countriesWithNew = { ...state.countries, [newCountryId]: newCountry }
  const stateWithNew = { ...state, countries: countriesWithNew }

  // Step 4b: Set up leader office assignment
  // Use the current house leader (alive), falling back to the first alive member
  const leaderId =
    getHouseLeader(stateWithNew, rebelHouseId) ??
    rebelHouse.memberIds.find((id) => {
      const p = stateWithNew.persons[id]
      return p && p.alive
    })
  const stateWithLeader = leaderId
    ? createOfficeAssignment(
        stateWithNew,
        { kind: 'country', id: newCountryId },
        'leader',
        leaderId,
      )
    : stateWithNew

  // Step 5: Move house to new country
  const movedState = moveHouseToCountry(stateWithLeader, rebelHouseId, newCountryId)

  // Step 6: Re-read old country from moved state
  const updatedOldCountry = movedState.countries[oldCountry.id]
  if (!updatedOldCountry) return movedState

  // Step 7: Apply penalties to old country
  const penalizedOldCountry = {
    ...updatedOldCountry,
    legacyPrestige: clamp(updatedOldCountry.legacyPrestige - 10, 0, 100),
    adminPower: clamp(updatedOldCountry.adminPower - 5, 0, 100),
  }

  // Step 8: Fix capitalProvinceId if it was moved to the new country
  const capProv = movedState.provinces[penalizedOldCountry.capitalProvinceId]
  const finalOldCountry: Country =
    penalizedOldCountry.capitalProvinceId !== ('' as ProvinceId) &&
    (!capProv || capProv.countryId !== oldCountry.id)
      ? {
          ...penalizedOldCountry,
          capitalProvinceId: (Object.values(movedState.provinces).find(
            (p) => p !== undefined && p.countryId === oldCountry.id,
          )?.id ?? '') as ProvinceId,
        }
      : penalizedOldCountry

  // Step 9: If old country has no active houses remaining, deactivate it
  const hasActiveHouses = finalOldCountry.houseIds.some((hid) => {
    const h = movedState.houses[hid]
    return h && h.active
  })
  const resolvedOldCountry = hasActiveHouses
    ? finalOldCountry
    : { ...finalOldCountry, active: false }

  return {
    ...movedState,
    countries: {
      ...movedState.countries,
      [oldCountry.id]: resolvedOldCountry,
    },
  }
}
