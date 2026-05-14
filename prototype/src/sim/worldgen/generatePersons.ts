import type { RngState } from '../rng/rng'
import type { HouseId, CountryId } from '../types/ids'
import type { Person } from '../types/person'
import { createPersonId } from '../types/ids'
import { randomFloat, randomInt } from '../rng/rng'
import { personName } from './nameGenerators'

export function generatePersons(
  houseProvinces: Map<HouseId, ProvinceId[]>,
  houseCountry: Map<HouseId, CountryId>,
  rng: RngState,
): { persons: Person[]; rng: RngState } {
  const persons: Person[] = []
  let globalIndex = 0

  const sortedHouseIds = Array.from(houseProvinces.keys()).sort()

  for (const houseId of sortedHouseIds) {
    const countryId = houseCountry.get(houseId)
    if (!countryId) {
      continue
    }

    for (let i = 0; i < 6; i++) {
      const id = createPersonId('pe', globalIndex)

      const { value: ageRoll, rng: rollRng } = randomFloat(rng)
      const rngAfterRoll = rollRng

      let age: number
      if (ageRoll < 0.25) {
        const result = randomInt(rngAfterRoll, 16, 25)
        age = result.value
        rng = result.rng
      } else if (ageRoll < 0.6) {
        const result = randomInt(rngAfterRoll, 26, 40)
        age = result.value
        rng = result.rng
      } else if (ageRoll < 0.9) {
        const result = randomInt(rngAfterRoll, 41, 60)
        age = result.value
        rng = result.rng
      } else {
        const result = randomInt(rngAfterRoll, 61, 75)
        age = result.value
        rng = result.rng
      }

      const { value: admin, rng: adminRng } = randomInt(rng, 0, 10)
      const { value: martial, rng: martialRng } = randomInt(adminRng, 0, 10)
      const { value: ambition, rng: t1Rng } = randomFloat(martialRng)
      const { value: loyaltyToCountry, rng: t2Rng } = randomFloat(t1Rng)
      const { value: caution, rng: t3Rng } = randomFloat(t2Rng)
      const { value: prestige, rng: finalRng } = randomInt(t3Rng, 0, 30)

      const person: Person = {
        id,
        name: personName(globalIndex),
        age,
        alive: true,
        houseId,
        countryId,
        stats: {
          admin,
          martial,
        },
        traits: {
          ambition,
          loyaltyToCountry,
          caution,
        },
        prestige,
      }

      persons.push(person)
      globalIndex++
      rng = finalRng
    }
  }

  return { persons, rng }
}
