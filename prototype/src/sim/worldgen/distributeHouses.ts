import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, PolityId } from '../types/ids'
import type { Province } from '../types/province'
import { createHouseId, createPolityId } from '../types/ids'
import { shuffle, randomInt } from '../rng/rng'

export function distributeHouses(
  provinces: Province[],
  assignments: Map<ProvinceId, PolityId>,
  rng: RngState,
): {
  houseProvinces: Map<HouseId, ProvinceId[]>
  housePolity: Map<HouseId, PolityId>
  rng: RngState
} {
  const houseProvinces = new Map<HouseId, ProvinceId[]>()
  const housePolity = new Map<HouseId, PolityId>()

  for (let polityIndex = 0; polityIndex < 3; polityIndex++) {
    const polityId = createPolityId('c', polityIndex)
    const polityProvinces = provinces
      .filter((p) => assignments.get(p.id) === polityId)
      .map((p) => p.id)

    for (let houseIndex = 0; houseIndex < 5; houseIndex++) {
      const houseId = createHouseId('h', polityIndex * 5 + houseIndex)
      const polityIdForHouse = createPolityId('c', polityIndex)
      housePolity.set(houseId, polityIdForHouse)
    }

    let remainingProvinces = [...polityProvinces]

    for (let houseIndex = 0; houseIndex < 5; houseIndex++) {
      const houseId = createHouseId('h', polityIndex * 5 + houseIndex)
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

  return { houseProvinces, housePolity, rng }
}
