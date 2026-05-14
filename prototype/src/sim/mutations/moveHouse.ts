import type { HouseId, CountryId } from '../types/ids'
import type { WorldState } from '../types/world'

export function moveHouseToCountry(
  state: WorldState,
  houseId: HouseId,
  newCountryId: CountryId,
): WorldState {
  const house = state.houses[houseId]
  if (!house) throw new Error('House not found')

  const oldCountry = state.countries[house.countryId]
  if (!oldCountry) throw new Error('Old country not found')

  const newCountry = state.countries[newCountryId]
  if (!newCountry) throw new Error('New country not found')

  const newHouses = { ...state.houses }
  newHouses[house.id] = {
    ...house,
    countryId: newCountryId,
  }

  const newCountries = { ...state.countries }
  newCountries[oldCountry.id] = {
    ...oldCountry,
    houseIds: oldCountry.houseIds.filter((id) => id !== houseId),
  }
  newCountries[newCountry.id] = {
    ...newCountry,
    houseIds: newCountry.houseIds.includes(houseId)
      ? newCountry.houseIds
      : [...newCountry.houseIds, houseId],
  }

  const newProvinces = { ...state.provinces } as typeof state.provinces
  for (const provinceId of Object.keys(state.provinces).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const province = state.provinces[provinceId]
    if (!province) continue
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (province.ownerHouseId === houseId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      newProvinces[provinceId] = {
        ...province,
        countryId: newCountryId,
      }
    }
  }

  const newPersons = { ...state.persons } as typeof state.persons
  for (const personId of Object.keys(state.persons).sort()) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const person = state.persons[personId]
    if (!person) continue
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (person.houseId === houseId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      newPersons[personId] = {
        ...person,
        countryId: newCountryId,
      }
    }
  }

  return {
    ...state,
    houses: newHouses,
    countries: newCountries,
    provinces: newProvinces,
    persons: newPersons,
  }
}
