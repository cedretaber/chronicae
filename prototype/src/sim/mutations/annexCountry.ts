import type { WorldState } from '../types/world'
import type { CountryId, HouseId, PersonId, ProvinceId } from '../types/ids'
import { defaultConfig } from '../config/defaultConfig'

export function annexCountry(
  state: WorldState,
  defeatedCountryId: CountryId,
  winnerCountryId: CountryId,
): WorldState {
  const defeatedCountry = state.countries[defeatedCountryId]
  if (!defeatedCountry) return state

  const winnerCountry = state.countries[winnerCountryId]
  if (!winnerCountry || !winnerCountry.active) return state

  const winnerRulerHouseId = winnerCountry.rulerHouseId
  const defeatedRulerHouseId = defeatedCountry.rulerHouseId

  const newProvinces = { ...state.provinces } as typeof state.provinces
  for (const provinceId of Object.keys(state.provinces).sort() as ProvinceId[]) {
    const province = state.provinces[provinceId]
    if (!province) continue
    if (province.countryId === defeatedCountryId) {
      newProvinces[provinceId] = {
        ...province,
        countryId: winnerCountryId,
        countryControl: defaultConfig.annexedCountryControl,
      }
    }
  }

  const newHouses = { ...state.houses } as typeof state.houses
  for (const houseId of Object.keys(state.houses).sort() as HouseId[]) {
    const house = state.houses[houseId]
    if (!house) continue
    if (house.countryId === defeatedCountryId) {
      newHouses[houseId] = { ...house, countryId: winnerCountryId }
    }
  }

  const defeatedRulerHouse = newHouses[defeatedRulerHouseId]
  if (defeatedRulerHouse) {
    const seatProvinceId = defeatedRulerHouse.seatProvinceId
    const seatProvince = newProvinces[seatProvinceId]
    if (seatProvince) {
      newProvinces[seatProvinceId] = {
        ...seatProvince,
        ownerHouseId: defeatedRulerHouseId,
      }
    }

    const winnerRulerHouse = newHouses[winnerRulerHouseId]
    if (winnerRulerHouse) {
      const newWinnerProvinceIds = [...winnerRulerHouse.provinceIds]
      const newDefeatedProvinceIds: ProvinceId[] = []

      for (const provinceId of defeatedRulerHouse.provinceIds) {
        const province = newProvinces[provinceId]
        if (!province) continue
        if (provinceId === seatProvinceId) {
          newDefeatedProvinceIds.push(provinceId)
        } else {
          newWinnerProvinceIds.push(provinceId)
          newProvinces[provinceId] = {
            ...province,
            ownerHouseId: winnerRulerHouseId,
            houseControl: defaultConfig.newRulerHouseControl,
          }
        }
      }

      newHouses[winnerRulerHouseId] = {
        ...winnerRulerHouse,
        provinceIds: newWinnerProvinceIds,
      }
      newHouses[defeatedRulerHouseId] = {
        ...defeatedRulerHouse,
        provinceIds: newDefeatedProvinceIds,
      }
    }
  }

  const newPersons = { ...state.persons }
  for (const personId of Object.keys(state.persons).sort() as PersonId[]) {
    const person = state.persons[personId]
    if (!person) continue
    if (person.countryId === defeatedCountryId) {
      newPersons[personId] = { ...person, countryId: winnerCountryId }
    }
  }

  const newWinnerHouseIds = [...new Set([...winnerCountry.houseIds, ...defeatedCountry.houseIds])]
  const newWinnerCountry = {
    ...winnerCountry,
    houseIds: newWinnerHouseIds,
  }

  const newDefeatedCountry = {
    ...defeatedCountry,
    active: false,
  }

  return {
    ...state,
    provinces: newProvinces,
    houses: newHouses,
    persons: newPersons,
    countries: {
      ...state.countries,
      [winnerCountryId]: newWinnerCountry,
      [defeatedCountryId]: newDefeatedCountry,
    },
  }
}
