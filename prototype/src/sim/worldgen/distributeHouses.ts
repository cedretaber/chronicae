import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, CountryId } from '../types/ids'
import type { Province } from '../types/province'
import { createHouseId, createCountryId } from '../types/ids'
import { shuffle, randomInt } from '../rng/rng'

export function distributeHouses(
  provinces: Province[],
  assignments: Map<ProvinceId, CountryId>,
  rng: RngState,
): {
  houseProvinces: Map<HouseId, ProvinceId[]>
  houseCountry: Map<HouseId, CountryId>
  rng: RngState
} {
  const houseProvinces = new Map<HouseId, ProvinceId[]>()
  const houseCountry = new Map<HouseId, CountryId>()

  for (let countryIndex = 0; countryIndex < 3; countryIndex++) {
    const countryId = createCountryId('c', countryIndex)
    const countryProvinces = provinces
      .filter((p) => assignments.get(p.id) === countryId)
      .map((p) => p.id)

    for (let houseIndex = 0; houseIndex < 5; houseIndex++) {
      const houseId = createHouseId('h', countryIndex * 5 + houseIndex)
      const countryIdForHouse = createCountryId('c', countryIndex)
      houseCountry.set(houseId, countryIdForHouse)
    }

    let remainingProvinces = [...countryProvinces]

    for (let houseIndex = 0; houseIndex < 5; houseIndex++) {
      const houseId = createHouseId('h', countryIndex * 5 + houseIndex)
      const total = remainingProvinces.length

      let count: number
      if (houseIndex === 0) {
        const { value: fracValue, rng: fracRng } = randomInt(rng, 25, 35)
        count = Math.max(1, Math.floor(total * (fracValue / 100)))
        rng = fracRng
      } else if (houseIndex <= 2) {
        const { value: fracValue, rng: fracRng } = randomInt(rng, 15, 25)
        count = Math.max(1, Math.floor(total * (fracValue / 100)))
        rng = fracRng
      } else if (houseIndex === 3) {
        count = Math.ceil(total / 2)
      } else {
        count = total
      }

      let shuffledProvinces: ProvinceId[]
      if (remainingProvinces.length > 1) {
        const result = shuffle(rng, remainingProvinces)
        shuffledProvinces = result.value
        rng = result.rng
      } else {
        shuffledProvinces = [...remainingProvinces]
      }

      const assigned = shuffledProvinces.slice(0, count)
      houseProvinces.set(houseId, assigned)
      remainingProvinces = shuffledProvinces.slice(count)
    }
  }

  return { houseProvinces, houseCountry, rng }
}
