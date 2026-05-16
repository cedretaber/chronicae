import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, CountryId, PersonId, PopGroupId } from '../types/ids'
import { newPopGroupId } from '../types/ids'
import type { Province } from '../types/province'
import type { House } from '../types/house'
import type { Country } from '../types/country'
import type { Person } from '../types/person'
import type { PopGroup } from '../types/popGroup'
import { createRng } from '../rng/rng'
import { randomInt } from '../rng/rng'
import { generateProvinces } from './generateProvinces'
import { distributeCountries } from './distributeCountries'
import { distributeHouses } from './distributeHouses'
import { generatePersons } from './generatePersons'
import {
  houseName,
  countryName,
  pickUniqueName,
  houseNamePool,
  countryNamePool,
} from './nameGenerators'
import { defaultConfig } from '../config/defaultConfig'
import { defaultMapConfig } from './mapConfig'
import { clamp } from '../utils/math'
import { countryAttitudeKey, houseAttitudeKey, personAttitudeKey } from '../helpers/attitudeHelpers'

export function generateWorld(seedText: string): { world: WorldState; rng: RngState } {
  let rng = createRng(seedText)

  const { provinces, rng: rng0 } = generateProvinces(rng, defaultMapConfig)
  rng = rng0

  const { assignments, rng: rng1 } = distributeCountries(provinces, rng)
  rng = rng1

  const { houseProvinces, houseCountry, rng: rng2 } = distributeHouses(provinces, assignments, rng)
  rng = rng2

  const { persons, rng: rng3 } = generatePersons(houseProvinces, houseCountry, defaultConfig, rng)
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
    const { value: habitability, rng: r1 } = randomInt(rng, 30, 90)
    const { value: development, rng: r2 } = randomInt(r1, -10, 10)
    rng = r2

    const ownerHouseId = provinceToHouse.get(province.id)

    finalProvinces.push({
      ...province,
      ownerHouseId: ownerHouseId ?? ('' as HouseId),
      countryId: assignments.get(province.id) ?? ('' as CountryId),
      habitability,
      development,
      popGroupIds: [],
    })
  }

  const houses: House[] = []
  const sortedHouseIds = Array.from(houseProvinces.keys()).sort()

  const usedCountryNames = new Set<string>()
  const usedHouseNames = new Set<string>()

  const provinceMap = new Map<ProvinceId, Province>()
  for (const p of finalProvinces) {
    provinceMap.set(p.id, p)
  }

  const { controlMaxDistancePenalty, controlMaxMinimum } = defaultConfig

  for (const houseId of sortedHouseIds) {
    const { value: legacyPrestige, rng: r1 } = randomInt(rng, 20, 80)
    const { value: wealth, rng: r2 } = randomInt(r1, 30, 150)
    rng = r2

    const memberIds = persons
      .filter((p) => p.houseId === houseId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => p.id)

    const provinceIds = houseProvinces.get(houseId) ?? []

    let seatProvinceId: ProvinceId = '' as ProvinceId
    if (provinceIds.length > 0) {
      const sortedProvinceIds = [...provinceIds].sort()
      const firstId = sortedProvinceIds[0]!
      let bestId = firstId
      let bestDev = provinceMap.get(firstId)!.development
      for (let i = 1; i < sortedProvinceIds.length; i++) {
        const pid = sortedProvinceIds[i]!
        const prov = provinceMap.get(pid)
        if (!prov) continue
        if (prov.development > bestDev) {
          bestDev = prov.development
          bestId = pid
        }
      }
      seatProvinceId = bestId
    }

    const countryId = houseCountry.get(houseId)

    // First try adult males
    const adultMaleCandidates = persons
      .filter(
        (p) =>
          p.houseId === houseId && p.alive && p.sex === 'male' && p.age >= defaultConfig.adultAge,
      )
      .sort((a, b) => a.id.localeCompare(b.id))

    let headId: PersonId | undefined
    if (adultMaleCandidates.length > 0) {
      let bestScore = -Infinity
      let bestPerson: Person | undefined
      for (const c of adultMaleCandidates) {
        const score = c.legacyPrestige * 0.5 + c.stats.admin * 2 + c.stats.martial * 2
        if (score > bestScore) {
          bestScore = score
          bestPerson = c
        }
      }
      headId = bestPerson?.id
    }

    // Then adult females
    if (!headId) {
      const adultFemaleCandidates = persons
        .filter(
          (p) =>
            p.houseId === houseId &&
            p.alive &&
            p.sex === 'female' &&
            p.age >= defaultConfig.adultAge,
        )
        .sort((a, b) => a.id.localeCompare(b.id))

      if (adultFemaleCandidates.length > 0) {
        let bestScore = -Infinity
        let bestPerson: Person | undefined
        for (const c of adultFemaleCandidates) {
          const score = c.legacyPrestige * 0.5 + c.stats.admin * 2 + c.stats.martial * 2
          if (score > bestScore) {
            bestScore = score
            bestPerson = c
          }
        }
        headId = bestPerson?.id
      }
    }

    // Then oldest
    if (!headId) {
      const allPersons = persons
        .filter((p) => p.houseId === houseId)
        .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))
      headId = allPersons[0]?.id
    }

    const houseIndex = parseInt(houseId.split('-')[1] ?? '0', 10)

    const { name: hName, rng: rH } = pickUniqueName(
      houseNamePool(),
      usedHouseNames,
      houseName,
      houseIndex,
      rng,
    )
    rng = rH

    const house: House = {
      id: houseId,
      name: hName,
      active: true,
      countryId: countryId ?? ('' as CountryId),
      provinceIds,
      memberIds,
      headId: headId ?? memberIds[0] ?? ('' as PersonId),
      cadetHouseIds: [],
      legacyPrestige,
      wealth,
      seatProvinceId,
    }

    houses.push(house)
  }

  const countries: Country[] = []

  for (let countryIndex = 0; countryIndex < 3; countryIndex++) {
    const countryId = `c-${countryIndex}` as CountryId

    const { value: treasury, rng: r1 } = randomInt(rng, 100, 300)
    const { value: legacyPrestige, rng: r2 } = randomInt(r1, 20, 60)
    rng = r2

    const { name: cName, rng: rC } = pickUniqueName(
      countryNamePool(),
      usedCountryNames,
      countryName,
      countryIndex,
      rng,
    )
    rng = rC

    const houseIds = houses
      .filter((h) => h.countryId === countryId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((h) => h.id)

    const rulerHouseId = houseIds[0] ?? ('' as HouseId)

    const rulerHouse = houses.find((h) => h.id === rulerHouseId)
    const capitalProvinceId = rulerHouse?.seatProvinceId ?? ('' as ProvinceId)

    const country: Country = {
      id: countryId,
      name: cName,
      rulerHouseId,
      houseIds,
      treasury,
      legacyPrestige,
      adminPower: 50,
      roleAssignments: {},
      active: true,
      capitalProvinceId,
    }

    countries.push(country)
  }

  const visited = new Set<ProvinceId>()
  const queue = new Array<string>()

  for (const country of countries) {
    const capProv = provinceMap.get(country.capitalProvinceId)
    if (!capProv) {
      for (const p of finalProvinces) {
        if (p.countryId === country.id) {
          p.countryControl = 30
        }
      }
      continue
    }

    for (const p of finalProvinces) {
      if (p.countryId === country.id) {
        p.countryControl = 30
      }
    }

    const distMap = new Map<ProvinceId, number>()
    distMap.set(capProv.id, 0)
    capProv.countryControl = 100

    visited.clear()
    visited.add(capProv.id)
    queue.length = 0
    queue.push(capProv.id)

    while (queue.length > 0) {
      const nextQueue: string[] = []
      for (const currentIdStr of queue) {
        const currentId = currentIdStr as ProvinceId
        const currentDist = distMap.get(currentId) ?? 0
        const currentProv = provinceMap.get(currentId)
        if (!currentProv) continue
        for (const neighborId of currentProv.neighbors) {
          if (visited.has(neighborId)) continue
          const neighborProv = provinceMap.get(neighborId)
          if (!neighborProv) continue
          if (neighborProv.countryId !== country.id) continue
          visited.add(neighborId)
          const neighborDist = currentDist + 1
          distMap.set(neighborId, neighborDist)
          const maxControl = clamp(
            100 - neighborDist * controlMaxDistancePenalty,
            controlMaxMinimum,
            100,
          )
          neighborProv.countryControl = maxControl
          nextQueue.push(neighborId)
        }
      }
      queue.length = 0
      for (const n of nextQueue) {
        queue.push(n)
      }
    }
  }

  for (const house of houses) {
    const seatProv = provinceMap.get(house.seatProvinceId)
    if (!seatProv) {
      for (const p of finalProvinces) {
        if (p.ownerHouseId === house.id) {
          p.houseControl = 30
        }
      }
      continue
    }

    const houseDistMap = new Map<ProvinceId, number>()
    houseDistMap.set(seatProv.id, 0)
    if (seatProv.ownerHouseId === house.id) {
      seatProv.houseControl = 100
    }

    visited.clear()
    visited.add(seatProv.id)
    queue.length = 0
    queue.push(seatProv.id)

    while (queue.length > 0) {
      const nextQueue: string[] = []
      for (const currentIdStr of queue) {
        const currentId = currentIdStr as ProvinceId
        const currentDist = houseDistMap.get(currentId) ?? 0
        const currentProv = provinceMap.get(currentId)
        if (!currentProv) continue
        for (const neighborId of currentProv.neighbors) {
          if (visited.has(neighborId)) continue
          const neighborProv = provinceMap.get(neighborId)
          if (!neighborProv) continue
          if (neighborProv.countryId !== house.countryId) continue
          visited.add(neighborId)
          const neighborDist = currentDist + 1
          houseDistMap.set(neighborId, neighborDist)
          if (neighborProv.ownerHouseId === house.id) {
            const maxControl = clamp(
              100 - neighborDist * controlMaxDistancePenalty,
              controlMaxMinimum,
              100,
            )
            neighborProv.houseControl = maxControl
          }
          nextQueue.push(neighborId)
        }
      }
      queue.length = 0
      for (const n of nextQueue) {
        queue.push(n)
      }
    }

    for (const p of finalProvinces) {
      if (p.ownerHouseId === house.id && !visited.has(p.id)) {
        p.houseControl = 30
      }
    }
  }

  const popGroupsRecord: Record<PopGroupId, PopGroup> = {}
  const { populationCapacityPerHabitability, minProvinceCarryingCapacity, minPopSizeByClass } =
    defaultConfig

  for (const province of finalProvinces) {
    const baseCapacity = province.habitability * populationCapacityPerHabitability
    const devMod = Math.min(1.5, Math.max(0.5, 1 + province.development / 200))
    const capacity = Math.max(minProvinceCarryingCapacity, baseCapacity * devMod)

    const { value: peasantSizePct, rng: rp1 } = randomInt(rng, 55, 75)
    const { value: townsmanSizePct, rng: rp2 } = randomInt(rp1, 5, 15)
    const { value: noblesSizePct, rng: rp3 } = randomInt(rp2, 2, 5)
    const { value: peasantWealth, rng: rp4 } = randomInt(rp3, 35, 60)
    const { value: townsmanWealth, rng: rp5 } = randomInt(rp4, 45, 70)
    const { value: noblesWealth, rng: rp6 } = randomInt(rp5, 50, 80)
    const { value: peasantUnrest, rng: rp7 } = randomInt(rp6, 10, 30)
    const { value: townsmanUnrest, rng: rp8 } = randomInt(rp7, 10, 25)
    const { value: noblesUnrest, rng: rp9 } = randomInt(rp8, 5, 25)
    rng = rp9

    const pid = province.id
    const peasantsId = newPopGroupId(`pop-${pid}-peasants`)
    const townsmanId = newPopGroupId(`pop-${pid}-townsmen`)
    const noblesId = newPopGroupId(`pop-${pid}-nobles`)

    popGroupsRecord[peasantsId] = {
      id: peasantsId,
      provinceId: pid,
      class: 'peasants',
      size: Math.max(minPopSizeByClass.peasants, (capacity * peasantSizePct) / 100),
      wealth: peasantWealth,
      unrest: peasantUnrest,
      attitudes: {},
    }
    popGroupsRecord[townsmanId] = {
      id: townsmanId,
      provinceId: pid,
      class: 'townsmen',
      size: Math.max(minPopSizeByClass.townsmen, (capacity * townsmanSizePct) / 100),
      wealth: townsmanWealth,
      unrest: townsmanUnrest,
      attitudes: {},
    }
    popGroupsRecord[noblesId] = {
      id: noblesId,
      provinceId: pid,
      class: 'nobles',
      size: Math.max(minPopSizeByClass.nobles, (capacity * noblesSizePct) / 100),
      wealth: noblesWealth,
      unrest: noblesUnrest,
      attitudes: {},
    }

    province.popGroupIds = [peasantsId, townsmanId, noblesId]
  }

  // §6.1 Person attitude initialization
  const updatedPersons = persons.map((p) => {
    if (!p.alive) return p
    let attitudes = { ...p.attitudes }
    const countryKey = countryAttitudeKey(p.countryId)
    const { value: aff1, rng: r1 } = randomInt(rng, 20, 70)
    const { value: res1, rng: r2 } = randomInt(r1, 20, 70)
    rng = r2
    attitudes = {
      ...attitudes,
      [countryKey]: { affection: aff1, respect: res1 },
    }

    const houseKey = houseAttitudeKey(p.houseId)
    const { value: aff2, rng: r3 } = randomInt(rng, 30, 80)
    const { value: res2, rng: r4 } = randomInt(r3, 20, 70)
    rng = r4
    attitudes = {
      ...attitudes,
      [houseKey]: { affection: aff2, respect: res2 },
    }

    const house = houses.find((h) => h.id === p.houseId)
    if (house && p.id !== house.headId) {
      const headKey = personAttitudeKey(house.headId)
      const { value: aff3, rng: r5 } = randomInt(rng, 20, 80)
      const { value: res3, rng: r6 } = randomInt(r5, 20, 80)
      rng = r6
      attitudes = {
        ...attitudes,
        [headKey]: { affection: aff3, respect: res3 },
      }
    }

    return { ...p, attitudes }
  })

  // §6.2 PopGroup attitude initialization
  for (const popGroupId of Object.keys(popGroupsRecord) as PopGroupId[]) {
    const pop = popGroupsRecord[popGroupId]
    if (!pop) continue
    const province = provinceMap.get(pop.provinceId)
    if (!province) continue

    const countryKey = countryAttitudeKey(province.countryId)
    const { value: aff1, rng: rp1 } = randomInt(rng, 10, 60)
    const { value: res1, rng: rp2 } = randomInt(rp1, 20, 70)
    rng = rp2
    let attitudes = {
      [countryKey]: { affection: aff1, respect: res1 },
    }

    const ownerHouseId = province.ownerHouseId
    if (ownerHouseId) {
      const houseKey = houseAttitudeKey(ownerHouseId)
      const { value: aff2, rng: rp3 } = randomInt(rng, 10, 60)
      const { value: res2, rng: rp4 } = randomInt(rp3, 20, 70)
      rng = rp4
      attitudes = {
        ...attitudes,
        [houseKey]: { affection: aff2, respect: res2 },
      }
    }

    // Apply class adjustments
    if (pop.class === 'peasants') {
      const ownerHouseAttitude = attitudes[houseAttitudeKey(ownerHouseId)]
      if (ownerHouseAttitude) {
        attitudes = {
          ...attitudes,
          [houseAttitudeKey(ownerHouseId)]: {
            ...ownerHouseAttitude,
            respect: clamp(ownerHouseAttitude.respect + 5, -100, 100),
          },
        }
      }
    } else if (pop.class === 'townsmen') {
      const countryAttitude = attitudes[countryKey]
      if (countryAttitude) {
        attitudes = {
          ...attitudes,
          [countryKey]: {
            ...countryAttitude,
            respect: clamp(countryAttitude.respect + 5, -100, 100),
          },
        }
      }
      const ownerHouseAttitude = attitudes[houseAttitudeKey(ownerHouseId)]
      if (ownerHouseAttitude) {
        attitudes = {
          ...attitudes,
          [houseAttitudeKey(ownerHouseId)]: {
            ...ownerHouseAttitude,
            respect: clamp(ownerHouseAttitude.respect - 5, -100, 100),
          },
        }
      }
    } else if (pop.class === 'nobles') {
      const ownerHouseAttitude = attitudes[houseAttitudeKey(ownerHouseId)]
      if (ownerHouseAttitude) {
        attitudes = {
          ...attitudes,
          [houseAttitudeKey(ownerHouseId)]: {
            ...ownerHouseAttitude,
            respect: clamp(ownerHouseAttitude.respect + 10, -100, 100),
          },
        }
      }
      const countryAttitude = attitudes[countryKey]
      if (countryAttitude) {
        attitudes = {
          ...attitudes,
          [countryKey]: {
            ...countryAttitude,
            affection: clamp(countryAttitude.affection - 5, -100, 100),
          },
        }
      }
    }

    popGroupsRecord[popGroupId] = { ...pop, attitudes: attitudes }
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
  for (const p of updatedPersons) {
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
    popGroups: popGroupsRecord,
  }

  return { world, rng }
}
