import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, CountryId, PersonId } from '../types/ids'
import type { Province } from '../types/province'
import type { House } from '../types/house'
import type { Country } from '../types/country'
import type { Person } from '../types/person'
import { createRng } from '../rng/rng'
import { randomInt } from '../rng/rng'
import { generateProvinces } from './generateProvinces'
import { distributeCountries } from './distributeCountries'
import { distributeHouses } from './distributeHouses'
import { generatePersons } from './generatePersons'
import { houseName, countryName } from './nameGenerators'

export function generateWorld(seedText: string): { world: WorldState; rng: RngState } {
  let rng = createRng(seedText)

  const provinces = generateProvinces()

  const { assignments, rng: rng1 } = distributeCountries(provinces, rng)
  rng = rng1

  const { houseProvinces, houseCountry, rng: rng2 } = distributeHouses(provinces, assignments, rng)
  rng = rng2

  const { persons, rng: rng3 } = generatePersons(houseProvinces, houseCountry, rng)
  rng = rng3

  const personMap = new Map<PersonId, Person>()
  for (const p of persons) {
    personMap.set(p.id, p)
  }

  const provinceToHouse = new Map<ProvinceId, HouseId>()
  for (const [houseId, provinceIds] of houseProvinces) {
    for (const pid of provinceIds) {
      provinceToHouse.set(pid, houseId)
    }
  }

  const provinceList = provinces.sort((a, b) => a.id.localeCompare(b.id))

  const finalProvinces: Province[] = []
  for (const province of provinceList) {
    const { value: baseTax, rng: r1 } = randomInt(rng, 1, 10)
    const { value: manpower, rng: r2 } = randomInt(r1, 1, 10)
    const { value: unrest, rng: r3 } = randomInt(r2, 0, 20)
    const { value: development, rng: r4 } = randomInt(r3, -10, 10)
    rng = r4

    const ownerHouseId = provinceToHouse.get(province.id)

    finalProvinces.push({
      ...province,
      ownerHouseId: ownerHouseId ?? ('' as HouseId),
      countryId: assignments.get(province.id) ?? ('' as CountryId),
      baseTax,
      manpower,
      unrest,
      development,
    })
  }

  const houses: House[] = []
  const sortedHouseIds = Array.from(houseProvinces.keys()).sort()

  for (const houseId of sortedHouseIds) {
    const { value: prestige, rng: r1 } = randomInt(rng, 20, 80)
    const { value: cohesion, rng: r2 } = randomInt(r1, 40, 80)
    const { value: loyaltyToCountry, rng: r3 } = randomInt(r2, 40, 80)
    const { value: wealth, rng: r4 } = randomInt(r3, 30, 150)
    rng = r4

    const memberIds = persons
      .filter((p) => p.houseId === houseId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => p.id)

    const provinceIds = houseProvinces.get(houseId) ?? []

    const countryId = houseCountry.get(houseId)

    const candidates = persons
      .filter((p) => p.houseId === houseId && p.alive && p.age >= 30)
      .sort((a, b) => a.id.localeCompare(b.id))

    let headId: PersonId | undefined
    if (candidates.length > 0) {
      let bestScore = -Infinity
      let bestPerson: Person | undefined
      for (const c of candidates) {
        const score = c.prestige * 0.5 + c.stats.admin * 2 + c.stats.martial * 2
        if (score > bestScore) {
          bestScore = score
          bestPerson = c
        }
      }
      headId = bestPerson?.id
    }

    if (!headId) {
      const allPersons = persons
        .filter((p) => p.houseId === houseId)
        .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))
      headId = allPersons[0]?.id
    }

    const houseIndex = parseInt(houseId.split('-')[1] ?? '0', 10)

    const house: House = {
      id: houseId,
      name: houseName(houseIndex),
      active: true,
      countryId: countryId ?? ('' as CountryId),
      provinceIds,
      memberIds,
      headId: headId ?? memberIds[0] ?? ('' as PersonId),
      prestige,
      cohesion,
      loyaltyToCountry,
      wealth,
    }

    houses.push(house)
  }

  const countries: Country[] = []

  for (let countryIndex = 0; countryIndex < 3; countryIndex++) {
    const countryId = `c-${countryIndex}` as CountryId

    const { value: treasury, rng: r1 } = randomInt(rng, 100, 300)
    const { value: legitimacy, rng: r2 } = randomInt(r1, 45, 80)
    const { value: adminPower, rng: r3 } = randomInt(r2, 35, 70)
    const { value: stability, rng: r4 } = randomInt(r3, 45, 80)
    rng = r4

    const houseIds = houses
      .filter((h) => h.countryId === countryId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((h) => h.id)

    const rulerHouseId = houseIds[0] ?? ('' as HouseId)

    const country: Country = {
      id: countryId,
      name: countryName(countryIndex),
      rulerHouseId,
      houseIds,
      treasury,
      legitimacy,
      adminPower,
      stability,
      roleAssignments: {},
      active: true,
    }

    countries.push(country)
  }

  const provincesRecord: Record<ProvinceId, Province> = {}
  for (const p of finalProvinces) {
    provincesRecord[p.id] = p
  }

  const housesRecord: Record<HouseId, House> = {}
  for (const h of houses) {
    housesRecord[h.id] = h
  }

  const personsRecord: Record<PersonId, Person> = {}
  for (const p of persons) {
    personsRecord[p.id] = p
  }

  const countriesRecord: Record<CountryId, Country> = {}
  for (const c of countries) {
    countriesRecord[c.id] = c
  }

  const world: WorldState = {
    currentYear: 1,
    currentMonth: 1,
    provinces: provincesRecord,
    countries: countriesRecord,
    houses: housesRecord,
    persons: personsRecord,
    activePlots: {},
  }

  return { world, rng }
}
