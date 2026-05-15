import type { ProvinceId, HouseId, CountryId } from '../types/ids'
import type { Province } from '../types/province'
import type { RngState } from '../rng/rng'
import { createProvinceId } from '../types/ids'
import { pickUniqueName, provinceName, provinceNamePool } from './nameGenerators'

const COLS = 8
const ROWS = 5

export function generateProvinces(
  rng: RngState,
  debugMode = false,
): { provinces: Province[]; rng: RngState } {
  const provinces: Province[] = []
  const usedNames = new Set<string>()
  const pool = provinceNamePool()
  let currentRng = rng

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col
      const id = createProvinceId('p', index)

      const neighbors: ProvinceId[] = []

      if (col > 0) {
        neighbors.push(createProvinceId('p', index - 1))
      }
      if (col < COLS - 1) {
        neighbors.push(createProvinceId('p', index + 1))
      }
      if (row > 0) {
        neighbors.push(createProvinceId('p', index - COLS))
      }
      if (row < ROWS - 1) {
        neighbors.push(createProvinceId('p', index + COLS))
      }

      let name: string
      if (debugMode) {
        name = provinceName(index)
      } else {
        const { name: n, rng: nextRng } = pickUniqueName(
          pool,
          usedNames,
          provinceName,
          index,
          currentRng,
        )
        name = n
        currentRng = nextRng
      }

      provinces.push({
        id,
        name,
        x: col * 100,
        y: row * 100,
        neighbors,
        ownerHouseId: '' as HouseId,
        countryId: '' as CountryId,
        baseTax: 0,
        manpower: 0,
        unrest: 0,
        development: 0,
        countryControl: 0,
        houseControl: 0,
      })
    }
  }

  return { provinces, rng: currentRng }
}
