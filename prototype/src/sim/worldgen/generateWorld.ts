import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, CountryId, PersonId, PopGroupId } from '../types/ids'
import { newPopGroupId } from '../types/ids'
import type { Province } from '../types/province'
import type { House } from '../types/house'
import type { Country } from '../types/country'
import type { Person } from '../types/person'
import type { PopGroup } from '../types/popGroup'
import type {
  OrganizationRef,
  ShareHolderRef,
  OrganizationShare,
  ShareIndex,
} from '../types/office'
import type { OrganizationShareId } from '../types/ids'
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
import { createOfficeAssignment } from '../mutations/officeMutations'
import { getHouseLeader } from '../selectors/officeSelectors'

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

    const capitalHouse = houseIds.length > 0 ? houses.find((h) => h.id === houseIds[0]) : undefined
    const capitalProvinceId = capitalHouse?.seatProvinceId ?? ('' as ProvinceId)

    const country: Country = {
      id: countryId,
      name: cName,
      houseIds,
      treasury,
      legacyPrestige,
      adminPower: 50,
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
    // Find house leader (same logic as original headId computation)
    let leaderPersonId: PersonId | undefined
    if (house) {
      const adultMaleCandidates = persons
        .filter(
          (p) =>
            p.houseId === house.id &&
            p.alive &&
            p.sex === 'male' &&
            p.age >= defaultConfig.adultAge,
        )
        .sort((a, b) => a.id.localeCompare(b.id))

      if (adultMaleCandidates.length > 0) {
        let bestScore = -Infinity
        for (const c of adultMaleCandidates) {
          const score = c.legacyPrestige * 0.5 + c.stats.admin * 2 + c.stats.martial * 2
          if (score > bestScore) {
            bestScore = score
            leaderPersonId = c.id
          }
        }
      }

      if (!leaderPersonId) {
        const adultFemaleCandidates = persons
          .filter(
            (p) =>
              p.houseId === house.id &&
              p.alive &&
              p.sex === 'female' &&
              p.age >= defaultConfig.adultAge,
          )
          .sort((a, b) => a.id.localeCompare(b.id))

        if (adultFemaleCandidates.length > 0) {
          let bestScore = -Infinity
          for (const c of adultFemaleCandidates) {
            const score = c.legacyPrestige * 0.5 + c.stats.admin * 2 + c.stats.martial * 2
            if (score > bestScore) {
              bestScore = score
              leaderPersonId = c.id
            }
          }
        }
      }

      if (!leaderPersonId) {
        const allPersons = persons
          .filter((p) => p.houseId === house.id)
          .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))
        leaderPersonId = allPersons[0]?.id
      }
    }

    if (house && leaderPersonId && p.id !== leaderPersonId) {
      const headKey = personAttitudeKey(leaderPersonId)
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

  // Initialize offices via createOfficeAssignment
  let officeState = {
    currentYear: 1,
    currentMonth: 1,
    provinces: provincesRecord,
    countries: countriesRecord,
    houses: housesRecord,
    persons: personsRecord,
    activePlots: {},
    popGroups: popGroupsRecord,
    organizationShares: {},
    officeAssignments: {},
    shareIndex: {},
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextOrganizationShareId: 0,
    nextOfficeAssignmentId: 0,
  } as unknown as WorldState

  // House leader offices
  for (const house of houses) {
    let leaderPersonId: PersonId | undefined

    const adultMaleCandidates = persons
      .filter(
        (p) =>
          p.houseId === house.id && p.alive && p.sex === 'male' && p.age >= defaultConfig.adultAge,
      )
      .sort((a, b) => a.id.localeCompare(b.id))

    if (adultMaleCandidates.length > 0) {
      let bestScore = -Infinity
      for (const c of adultMaleCandidates) {
        const score = c.legacyPrestige * 0.5 + c.stats.admin * 2 + c.stats.martial * 2
        if (score > bestScore) {
          bestScore = score
          leaderPersonId = c.id
        }
      }
    }

    if (!leaderPersonId) {
      const adultFemaleCandidates = persons
        .filter(
          (p) =>
            p.houseId === house.id &&
            p.alive &&
            p.sex === 'female' &&
            p.age >= defaultConfig.adultAge,
        )
        .sort((a, b) => a.id.localeCompare(b.id))

      if (adultFemaleCandidates.length > 0) {
        let bestScore = -Infinity
        for (const c of adultFemaleCandidates) {
          const score = c.legacyPrestige * 0.5 + c.stats.admin * 2 + c.stats.martial * 2
          if (score > bestScore) {
            bestScore = score
            leaderPersonId = c.id
          }
        }
      }
    }

    if (!leaderPersonId) {
      const allPersons = persons
        .filter((p) => p.houseId === house.id)
        .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))
      leaderPersonId = allPersons[0]?.id
    }

    if (leaderPersonId) {
      officeState = createOfficeAssignment(
        officeState,
        { kind: 'house', id: house.id },
        'leader',
        leaderPersonId,
      )
    }
  }

  // Country offices
  for (const country of countries) {
    // Country ruler: use leader of the house with the most provinces
    let bestHouseId: HouseId | undefined
    let bestProvinceCount = -1
    for (const houseId of country.houseIds) {
      const house = housesRecord[houseId]
      if (!house || !house.active) continue
      if (house.provinceIds.length > bestProvinceCount) {
        bestProvinceCount = house.provinceIds.length
        bestHouseId = houseId
      }
    }
    if (bestHouseId) {
      const rulerPersonId = getHouseLeader(officeState, bestHouseId)
      if (rulerPersonId) {
        officeState = createOfficeAssignment(
          officeState,
          { kind: 'country', id: country.id },
          'leader',
          rulerPersonId,
        )
      }
    }

    const countryPersons = persons.filter(
      (p) => p.countryId === country.id && p.alive && p.age >= defaultConfig.adultAge,
    )

    // Administrator: best admin stat
    const adminCandidate = countryPersons
      .filter((p) => {
        const personKey = p.id as string
        const pOffices = officeState.officeIndex.byHolderPerson[personKey] ?? []
        return !pOffices.some((oid) => {
          const o = officeState.officeAssignments[oid]
          return o && o.organization.kind === 'country' && o.role === 'leader'
        })
      })
      .sort((a, b) => b.stats.admin - a.stats.admin || a.id.localeCompare(b.id))[0]
    if (adminCandidate) {
      officeState = createOfficeAssignment(
        officeState,
        { kind: 'country', id: country.id },
        'administrator',
        adminCandidate.id,
      )
    }

    // Treasurer: best admin stat, different person
    const treasurerCandidate = countryPersons
      .filter((p) => p.id !== adminCandidate?.id)
      .filter((p) => {
        const personKey = p.id as string
        const pOffices = officeState.officeIndex.byHolderPerson[personKey] ?? []
        return !pOffices.some((oid) => {
          const o = officeState.officeAssignments[oid]
          return o && o.organization.kind === 'country' && o.role === 'leader'
        })
      })
      .sort((a, b) => b.stats.admin - a.stats.admin || a.id.localeCompare(b.id))[0]
    if (treasurerCandidate) {
      officeState = createOfficeAssignment(
        officeState,
        { kind: 'country', id: country.id },
        'treasurer',
        treasurerCandidate.id,
      )
    }

    // Military: best martial stat
    const militaryCandidate = countryPersons
      .filter((p) => {
        const personKey = p.id as string
        const pOffices = officeState.officeIndex.byHolderPerson[personKey] ?? []
        return !pOffices.some((oid) => {
          const o = officeState.officeAssignments[oid]
          return o && o.organization.kind === 'country' && o.role === 'leader'
        })
      })
      .sort((a, b) => b.stats.martial - a.stats.martial || a.id.localeCompare(b.id))[0]
    if (militaryCandidate) {
      officeState = createOfficeAssignment(
        officeState,
        { kind: 'country', id: country.id },
        'military',
        militaryCandidate.id,
      )
    }
  }

  // Build ruler house lookup for shares
  const rulerHouseIdForCountry = new Map<CountryId, HouseId>()
  for (const country of countries) {
    const countryOrgKey = `country:${country.id}`
    const countryOfficeIds = officeState.officeIndex.byOrganization[countryOrgKey] ?? []
    const countryLeaderOffice = countryOfficeIds
      .map((oid) => officeState.officeAssignments[oid])
      .find((o) => o && o.active && o.role === 'leader')
    if (countryLeaderOffice) {
      const leaderPerson = personsRecord[countryLeaderOffice.holderPersonId]
      if (leaderPerson) {
        rulerHouseIdForCountry.set(country.id, leaderPerson.houseId)
      }
    }
  }

  // Initialize shares
  const organizationShares: Record<OrganizationShareId, OrganizationShare> = {}
  const shareIndex: ShareIndex = { byOrganization: {}, byHolder: {} }
  let nextOrganizationShareId = 0

  function addShare(organization: OrganizationRef, holder: ShareHolderRef, rawPower: number): void {
    if (rawPower <= 0) return
    const id = `os-${nextOrganizationShareId}` as OrganizationShareId
    nextOrganizationShareId++
    const share: OrganizationShare = { id, organization, holder, rawPower }
    organizationShares[id] = share

    const orgKey = `${organization.kind}:${organization.id}`
    const holderKey = `${holder.kind}:${holder.id}`
    const existingByOrg = shareIndex.byOrganization[orgKey] ?? []
    const existingByHolder = shareIndex.byHolder[holderKey] ?? []
    shareIndex.byOrganization[orgKey] = [...existingByOrg, id]
    shareIndex.byHolder[holderKey] = [...existingByHolder, id]
  }

  // Country shares
  for (const country of countries) {
    const config = defaultConfig
    for (const houseId of country.houseIds) {
      const house = houses.find((h) => h.id === houseId)
      if (!house || !house.active) continue

      const countryOrgKey = `country:${country.id}`
      const countryOfficeIds = officeState.officeIndex.byOrganization[countryOrgKey] ?? []
      const countryOfficeCount = countryOfficeIds.filter((oid) => {
        const o = officeState.officeAssignments[oid]
        if (!o || o.role === 'leader') return false
        const holder = persons.find((p) => p.id === o.holderPersonId)
        return holder && holder.houseId === houseId
      }).length

      const housePrestige = house.legacyPrestige
      const militaryProxy = house.provinceIds.length * 10

      const rawPower =
        config.countryShareBase +
        house.provinceIds.length * config.countryShareProvinceFactor +
        militaryProxy * config.countryShareMilitaryFactor +
        house.wealth * config.countryShareWealthFactor +
        housePrestige * config.countrySharePrestigeFactor +
        (houseId === rulerHouseIdForCountry.get(country.id)
          ? config.countryShareRulerHouseBonus
          : 0) +
        countryOfficeCount * config.countryShareOfficeFactor

      addShare({ kind: 'country', id: country.id }, { kind: 'house', id: houseId }, rawPower)
    }
  }

  // House shares
  for (const house of houses) {
    if (!house.active) continue
    const config = defaultConfig

    const houseOrgKey = `house:${house.id}`
    const houseOfficeIds = officeState.officeIndex.byOrganization[houseOrgKey] ?? []
    const leaderOffice = houseOfficeIds
      .map((oid) => officeState.officeAssignments[oid])
      .find((o) => o && o.active && o.role === 'leader')
    const leaderPersonId = leaderOffice?.holderPersonId

    for (const personId of house.memberIds) {
      const person = persons.find((p) => p.id === personId)
      if (!person || !person.alive) continue

      const isLeader = person.id === leaderPersonId

      const personKey = person.id as string
      const personOfficeIds = officeState.officeIndex.byHolderPerson[personKey] ?? []
      const hasOffice = personOfficeIds.some((oid) => {
        const o = officeState.officeAssignments[oid]
        return o && o.active
      })

      const rawPower =
        config.houseShareBase +
        (isLeader ? config.houseShareLeaderBonus : 0) +
        (hasOffice ? config.houseShareOfficeBonus : 0) +
        person.legacyPrestige * config.houseSharePrestigeFactor +
        person.wealth * config.houseShareWealthFactor +
        (person.stats.admin + person.stats.martial) * config.houseShareStatFactor

      addShare({ kind: 'house', id: house.id }, { kind: 'person', id: personId }, rawPower)
    }
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
    organizationShares,
    officeAssignments: officeState.officeAssignments,
    shareIndex,
    officeIndex: officeState.officeIndex,
    nextOrganizationShareId,
    nextOfficeAssignmentId: officeState.nextOfficeAssignmentId,
  }

  return { world, rng }
}
