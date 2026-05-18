import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type { ProvinceId, HouseId, PolityId, PersonId, PopGroupId } from '../types/ids'
import { newPopGroupId } from '../types/ids'
import type { Province } from '../types/province'
import type { House } from '../types/house'
import type { Polity } from '../types/polity'
import type { Person } from '../types/person'
import type { PopGroup } from '../types/popGroup'
import type {
  OrganizationRef,
  ShareHolderRef,
  OrganizationShare,
  ShareIndex,
} from '../types/office'
import type { OrganizationShareId, LandContractId, ProvinceOfficeAssignmentId } from '../types/ids'
import type {
  LandContract,
  LandContractIndex,
  ProvinceTerminalPolityCache,
  ProvinceOfficeAssignment,
  ProvinceOfficeIndex,
  PolityIndex,
} from '../types/landContract'
import { ROOT_WORLD, ANONYMOUS_HOUSE_ID } from '../types/landContract'
import { createRng } from '../rng/rng'
import { randomInt } from '../rng/rng'
import { generateProvinces } from './generateProvinces'
import { distributePolities } from './distributePolities'
import { distributeHouses } from './distributeHouses'
import { generatePersons } from './generatePersons'
import {
  houseName,
  polityName,
  pickUniqueName,
  houseNamePool,
  polityNamePool,
} from './nameGenerators'
import { defaultConfig } from '../config/defaultConfig'
import { defaultMapConfig } from './mapConfig'
import { clamp } from '../utils/math'
import { polityAttitudeKey, houseAttitudeKey, personAttitudeKey } from '../helpers/attitudeHelpers'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { getHouseLeader } from '../selectors/officeSelectors'

export function generateWorld(seedText: string): { world: WorldState; rng: RngState } {
  let rng = createRng(seedText)

  const { provinces, rng: rng0 } = generateProvinces(rng, defaultMapConfig)
  rng = rng0

  const { assignments, rng: rng1 } = distributePolities(provinces, rng)
  rng = rng1

  const { houseProvinces, housePolity, rng: rng2 } = distributeHouses(provinces, assignments, rng)
  rng = rng2

  const { persons, rng: rng3 } = generatePersons(houseProvinces, housePolity, defaultConfig, rng)
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

  for (const province of provinceList) {
    const { value: habitability, rng: r1 } = randomInt(rng, 30, 90)
    const { value: development, rng: r2 } = randomInt(r1, -10, 10)
    rng = r2

    province.habitability = habitability
    province.development = development
    province.popGroupIds = []
  }

  const houses: House[] = []
  const sortedHouseIds = Array.from(houseProvinces.keys()).sort()

  const usedPolityNames = new Set<string>()
  const usedHouseNames = new Set<string>()

  const provinceMap = new Map<ProvinceId, Province>()
  for (const p of provinces) {
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
        const governanceScore =
          c.abilities.numeracy * 0.3 +
          c.abilities.learning * 0.3 +
          c.abilities.charisma * 0.2 +
          c.abilities.insight * 0.2
        const warCommandScore =
          c.abilities.command * 0.6 +
          c.abilities.insight * 0.2 +
          c.abilities.learning * 0.1 +
          c.abilities.valor * 0.1
        const score = c.legacyPrestige * 0.5 + governanceScore * 2 + warCommandScore * 2
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
          const governanceScore =
            c.abilities.numeracy * 0.3 +
            c.abilities.learning * 0.3 +
            c.abilities.charisma * 0.2 +
            c.abilities.insight * 0.2
          const warCommandScore =
            c.abilities.command * 0.6 +
            c.abilities.insight * 0.2 +
            c.abilities.learning * 0.1 +
            c.abilities.valor * 0.1
          const score = c.legacyPrestige * 0.5 + governanceScore * 2 + warCommandScore * 2
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
      memberIds,
      cadetHouseIds: [],
      legacyPrestige,
      wealth,
      seatProvinceId,
    }

    houses.push(house)
  }

  // v0.16: 階層的 Polity 構造を構築する。
  // distributeHouses で得た 15 House を以下のように rank 分けする:
  //   - Kingdom owners (rank 2): h-0, h-5, h-10  → Polity c-0, c-1, c-2
  //   - Duchy owners (rank 3):   h-1, h-2, h-6, h-11  → Polity c-3, c-4, c-5, c-6
  //   - County owners (rank 4):  h-3, h-4, h-7, h-8, h-9, h-12, h-13, h-14  → Polity c-7〜c-14
  //
  // 各 Polity の parent (= LandContract の grantor) は次表の通り固定する。
  type PolityInfo = { polityId: PolityId; rank: 2 | 3 | 4; parentPolityId?: PolityId }
  const HOUSE_POLITY_MAP: Record<string, PolityInfo> = {
    'h-0': { polityId: 'c-0' as PolityId, rank: 2 },
    'h-1': { polityId: 'c-3' as PolityId, rank: 3, parentPolityId: 'c-0' as PolityId },
    'h-2': { polityId: 'c-4' as PolityId, rank: 3, parentPolityId: 'c-0' as PolityId },
    'h-3': { polityId: 'c-7' as PolityId, rank: 4, parentPolityId: 'c-3' as PolityId },
    'h-4': { polityId: 'c-8' as PolityId, rank: 4, parentPolityId: 'c-4' as PolityId },
    'h-5': { polityId: 'c-1' as PolityId, rank: 2 },
    'h-6': { polityId: 'c-5' as PolityId, rank: 3, parentPolityId: 'c-1' as PolityId },
    'h-7': { polityId: 'c-9' as PolityId, rank: 4, parentPolityId: 'c-5' as PolityId },
    'h-8': { polityId: 'c-10' as PolityId, rank: 4, parentPolityId: 'c-5' as PolityId },
    'h-9': { polityId: 'c-11' as PolityId, rank: 4, parentPolityId: 'c-1' as PolityId },
    'h-10': { polityId: 'c-2' as PolityId, rank: 2 },
    'h-11': { polityId: 'c-6' as PolityId, rank: 3, parentPolityId: 'c-2' as PolityId },
    'h-12': { polityId: 'c-12' as PolityId, rank: 4, parentPolityId: 'c-6' as PolityId },
    'h-13': { polityId: 'c-13' as PolityId, rank: 4, parentPolityId: 'c-6' as PolityId },
    'h-14': { polityId: 'c-14' as PolityId, rank: 4, parentPolityId: 'c-2' as PolityId },
  }

  const polities: Polity[] = []

  // 各 House に対応する Polity を生成する (15 個)。
  const houseToPolityId = new Map<HouseId, PolityId>()
  const polityToOwnerHouse = new Map<PolityId, HouseId>()
  let polityNameCounter = 0
  for (const house of houses) {
    const info = HOUSE_POLITY_MAP[house.id as string]
    if (!info) continue
    houseToPolityId.set(house.id, info.polityId)
    polityToOwnerHouse.set(info.polityId, house.id)

    const { value: treasury, rng: r1 } = randomInt(rng, 100, 300)
    const { value: legacyPrestige, rng: r2 } = randomInt(r1, 20, 60)
    rng = r2

    const { name: cName, rng: rC } = pickUniqueName(
      polityNamePool(),
      usedPolityNames,
      polityName,
      polityNameCounter,
      rng,
    )
    polityNameCounter++
    rng = rC

    const capitalProvinceId = house.seatProvinceId

    const newPolity: Polity = {
      id: info.polityId,
      name: cName,
      treasury,
      legacyPrestige,
      adminPower: 50,
      active: true,
      capitalProvinceId,
      rank: info.rank,
      ownerHouseId: house.id,
    }

    polities.push(newPolity)
  }

  const visited = new Set<ProvinceId>()
  const queue = new Array<string>()

  for (const polity of polities) {
    const capProv = provinceMap.get(polity.capitalProvinceId)
    if (!capProv) {
      for (const p of provinces) {
        if (assignments.get(p.id) === polity.id) {
          p.polityControl = 30
        }
      }
      continue
    }

    for (const p of provinces) {
      if (assignments.get(p.id) === polity.id) {
        p.polityControl = 30
      }
    }

    const distMap = new Map<ProvinceId, number>()
    distMap.set(capProv.id, 0)
    capProv.polityControl = 100

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
          if (assignments.get(neighborId) !== polity.id) continue
          visited.add(neighborId)
          const neighborDist = currentDist + 1
          distMap.set(neighborId, neighborDist)
          const maxControl = clamp(
            100 - neighborDist * controlMaxDistancePenalty,
            controlMaxMinimum,
            100,
          )
          neighborProv.polityControl = maxControl
          nextQueue.push(neighborId)
        }
      }
      queue.length = 0
      for (const n of nextQueue) {
        queue.push(n)
      }
    }
  }
  // v0.16: houseControl BFS は廃止 (§8.2 §8.3)。Province の統治実効性は polityControl 単独。

  const popGroupsRecord: Record<PopGroupId, PopGroup> = {}
  const { populationCapacityPerHabitability, minProvinceCarryingCapacity, minPopSizeByClass } =
    defaultConfig

  for (const province of provinces) {
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
          const governanceScore =
            c.abilities.numeracy * 0.3 +
            c.abilities.learning * 0.3 +
            c.abilities.charisma * 0.2 +
            c.abilities.insight * 0.2
          const warCommandScore =
            c.abilities.command * 0.6 +
            c.abilities.insight * 0.2 +
            c.abilities.learning * 0.1 +
            c.abilities.valor * 0.1
          const score = c.legacyPrestige * 0.5 + governanceScore * 2 + warCommandScore * 2
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
            const governanceScore =
              c.abilities.numeracy * 0.3 +
              c.abilities.learning * 0.3 +
              c.abilities.charisma * 0.2 +
              c.abilities.insight * 0.2
            const warCommandScore =
              c.abilities.command * 0.6 +
              c.abilities.insight * 0.2 +
              c.abilities.learning * 0.1 +
              c.abilities.valor * 0.1
            const score = c.legacyPrestige * 0.5 + governanceScore * 2 + warCommandScore * 2
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

    const provincePolityId = assignments.get(province.id) ?? ('' as PolityId)
    const polityKey = polityAttitudeKey(provincePolityId)
    const { value: aff1, rng: rp1 } = randomInt(rng, 10, 60)
    const { value: res1, rng: rp2 } = randomInt(rp1, 20, 70)
    rng = rp2
    let attitudes = {
      [polityKey]: { affection: aff1, respect: res1 },
    }

    const ownerHouseId = provinceToHouse.get(province.id) ?? ('' as HouseId)
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
      const polityAttitude = attitudes[polityKey]
      if (polityAttitude) {
        attitudes = {
          ...attitudes,
          [polityKey]: {
            ...polityAttitude,
            respect: clamp(polityAttitude.respect + 5, -100, 100),
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
      const polityAttitude = attitudes[polityKey]
      if (polityAttitude) {
        attitudes = {
          ...attitudes,
          [polityKey]: {
            ...polityAttitude,
            affection: clamp(polityAttitude.affection - 5, -100, 100),
          },
        }
      }
    }

    popGroupsRecord[popGroupId] = { ...pop, attitudes: attitudes }
  }

  const provincesRecord: Record<ProvinceId, Province> = {}
  for (const p of provinces) {
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

  const politiesRecord: Record<PolityId, Polity> = {}
  for (const p of polities) {
    politiesRecord[p.id] = p
  }

  // Initialize offices via createOfficeAssignment
  let officeState = {
    currentYear: 1,
    currentMonth: 1,
    provinces: provincesRecord,
    polities: politiesRecord,
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
        const governanceScore =
          c.abilities.numeracy * 0.3 +
          c.abilities.learning * 0.3 +
          c.abilities.charisma * 0.2 +
          c.abilities.insight * 0.2
        const warCommandScore =
          c.abilities.command * 0.6 +
          c.abilities.insight * 0.2 +
          c.abilities.learning * 0.1 +
          c.abilities.valor * 0.1
        const score = c.legacyPrestige * 0.5 + governanceScore * 2 + warCommandScore * 2
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
          const governanceScore =
            c.abilities.numeracy * 0.3 +
            c.abilities.learning * 0.3 +
            c.abilities.charisma * 0.2 +
            c.abilities.insight * 0.2
          const warCommandScore =
            c.abilities.command * 0.6 +
            c.abilities.insight * 0.2 +
            c.abilities.learning * 0.1 +
            c.abilities.valor * 0.1
          const score = c.legacyPrestige * 0.5 + governanceScore * 2 + warCommandScore * 2
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

  // Polity offices
  for (const polity of polities) {
    // Polity ruler: chain がまだ未構築なので assignments / provinceToHouse の Map を直接使う。
    let bestHouseId: HouseId | undefined
    let bestProvinceCount = -1
    const polityHouseCandidates = new Set<HouseId>()
    for (const [pid, hid] of provinceToHouse) {
      if (assignments.get(pid) === polity.id) polityHouseCandidates.add(hid)
    }
    for (const houseId of polityHouseCandidates) {
      const house = housesRecord[houseId]
      if (!house || !house.active) continue
      let provincesOfHouse = 0
      for (const [pid, hid] of provinceToHouse) {
        if (hid === houseId && assignments.get(pid) === polity.id) provincesOfHouse += 1
      }
      if (provincesOfHouse > bestProvinceCount) {
        bestProvinceCount = provincesOfHouse
        bestHouseId = houseId
      }
    }
    if (bestHouseId) {
      const rulerPersonId = getHouseLeader(officeState, bestHouseId)
      if (rulerPersonId) {
        officeState = createOfficeAssignment(
          officeState,
          { kind: 'polity', id: polity.id },
          'leader',
          rulerPersonId,
        )
      }
    }

    const polityPersons = persons.filter(
      (p) =>
        p.houseId &&
        housePolity.get(p.houseId) === polity.id &&
        p.alive &&
        p.age >= defaultConfig.adultAge,
    )

    // Administrator: best admin stat
    const adminCandidate = polityPersons
      .filter((p) => {
        const personKey = p.id as string
        const pOffices = officeState.officeIndex.byHolderPerson[personKey] ?? []
        return !pOffices.some((oid) => {
          const o = officeState.officeAssignments[oid]
          return o && o.organization.kind === 'polity' && o.role === 'leader'
        })
      })
      .sort((a, b) => {
        const aGov =
          a.abilities.numeracy * 0.3 +
          a.abilities.learning * 0.3 +
          a.abilities.charisma * 0.2 +
          a.abilities.insight * 0.2
        const bGov =
          b.abilities.numeracy * 0.3 +
          b.abilities.learning * 0.3 +
          b.abilities.charisma * 0.2 +
          b.abilities.insight * 0.2
        return bGov - aGov || a.id.localeCompare(b.id)
      })[0]
    if (adminCandidate) {
      officeState = createOfficeAssignment(
        officeState,
        { kind: 'polity', id: polity.id },
        'administrator',
        adminCandidate.id,
      )
    }

    // Treasurer: best admin stat, different person
    const treasurerCandidate = polityPersons
      .filter((p) => p.id !== adminCandidate?.id)
      .filter((p) => {
        const personKey = p.id as string
        const pOffices = officeState.officeIndex.byHolderPerson[personKey] ?? []
        return !pOffices.some((oid) => {
          const o = officeState.officeAssignments[oid]
          return o && o.organization.kind === 'polity' && o.role === 'leader'
        })
      })
      .sort((a, b) => {
        const aGov =
          a.abilities.numeracy * 0.3 +
          a.abilities.learning * 0.3 +
          a.abilities.charisma * 0.2 +
          a.abilities.insight * 0.2
        const bGov =
          b.abilities.numeracy * 0.3 +
          b.abilities.learning * 0.3 +
          b.abilities.charisma * 0.2 +
          b.abilities.insight * 0.2
        return bGov - aGov || a.id.localeCompare(b.id)
      })[0]
    if (treasurerCandidate) {
      officeState = createOfficeAssignment(
        officeState,
        { kind: 'polity', id: polity.id },
        'treasurer',
        treasurerCandidate.id,
      )
    }

    // Military: best martial stat
    const militaryCandidate = polityPersons
      .filter((p) => {
        const personKey = p.id as string
        const pOffices = officeState.officeIndex.byHolderPerson[personKey] ?? []
        return !pOffices.some((oid) => {
          const o = officeState.officeAssignments[oid]
          return o && o.organization.kind === 'polity' && o.role === 'leader'
        })
      })
      .sort((a, b) => {
        const aWar =
          a.abilities.command * 0.6 +
          a.abilities.insight * 0.2 +
          a.abilities.learning * 0.1 +
          a.abilities.valor * 0.1
        const bWar =
          b.abilities.command * 0.6 +
          b.abilities.insight * 0.2 +
          b.abilities.learning * 0.1 +
          b.abilities.valor * 0.1
        return bWar - aWar || a.id.localeCompare(b.id)
      })[0]
    if (militaryCandidate) {
      officeState = createOfficeAssignment(
        officeState,
        { kind: 'polity', id: polity.id },
        'military',
        militaryCandidate.id,
      )
    }
  }

  // Build ruler house lookup for shares
  const rulerHouseIdForPolity = new Map<PolityId, HouseId>()
  for (const polity of polities) {
    const polityOrgKey = `polity:${polity.id}`
    const polityOfficeIds = officeState.officeIndex.byOrganization[polityOrgKey] ?? []
    const polityLeaderOffice = polityOfficeIds
      .map((oid) => officeState.officeAssignments[oid])
      .find((o) => o && o.active && o.role === 'leader')
    if (polityLeaderOffice) {
      const leaderPerson = personsRecord[polityLeaderOffice.holderPersonId]
      if (leaderPerson) {
        rulerHouseIdForPolity.set(polity.id, leaderPerson.houseId)
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

  // Polity shares (chain がまだ未構築なので housePolity / provinceToHouse Map を直接使う)
  for (const polity of polities) {
    const config = defaultConfig
    const polityHouseCandidates = new Set<HouseId>()
    for (const [pid, hid] of provinceToHouse) {
      if (assignments.get(pid) === polity.id) polityHouseCandidates.add(hid)
    }
    for (const houseId of polityHouseCandidates) {
      const house = houses.find((h) => h.id === houseId)
      if (!house || !house.active) continue

      const polityOrgKey = `polity:${polity.id}`
      const polityOfficeIds = officeState.officeIndex.byOrganization[polityOrgKey] ?? []
      const polityOfficeCount = polityOfficeIds.filter((oid) => {
        const o = officeState.officeAssignments[oid]
        if (!o || o.role === 'leader') return false
        const holder = persons.find((p) => p.id === o.holderPersonId)
        return holder && holder.houseId === houseId
      }).length

      const housePrestige = house.legacyPrestige
      let houseProvinceCount = 0
      for (const [pid, hid] of provinceToHouse) {
        if (hid === houseId && assignments.get(pid) === polity.id) houseProvinceCount += 1
      }
      const militaryProxy = houseProvinceCount * 10

      const rawPower =
        config.polityShareBase +
        houseProvinceCount * config.polityShareProvinceFactor +
        militaryProxy * config.polityShareMilitaryFactor +
        house.wealth * config.polityShareWealthFactor +
        housePrestige * config.politySharePrestigeFactor +
        (houseId === rulerHouseIdForPolity.get(polity.id) ? config.polityShareOwnerHouseBonus : 0) +
        polityOfficeCount * config.polityShareOfficeFactor

      addShare({ kind: 'polity', id: polity.id }, { kind: 'house', id: houseId }, rawPower)
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
        (person.abilities.numeracy * 0.3 +
          person.abilities.learning * 0.3 +
          person.abilities.charisma * 0.2 +
          person.abilities.insight * 0.2 +
          person.abilities.command * 0.6 +
          person.abilities.insight * 0.2 +
          person.abilities.learning * 0.1 +
          person.abilities.valor * 0.1) *
          config.houseShareStatFactor

      addShare({ kind: 'house', id: house.id }, { kind: 'person', id: personId }, rawPower)
    }
  }

  // v0.16: LandContract chain, AnonymousHouse, placeholder persons, ProvinceOfficeAssignments を生成
  const landContractsRecord: Record<LandContractId, LandContract> = {}
  const landContractIndex: LandContractIndex = {
    byProvince: {},
    byGranteePolity: {},
    byParent: {},
  }
  const provinceTerminalPolityCache: ProvinceTerminalPolityCache = {}
  let nextLandContractId = 0

  // 各 Polity の rank と parent を逆引きする map
  const polityRankMap = new Map<PolityId, 2 | 3 | 4>()
  const polityParentMap = new Map<PolityId, PolityId>()
  for (const info of Object.values(HOUSE_POLITY_MAP)) {
    polityRankMap.set(info.polityId, info.rank)
    if (info.parentPolityId !== undefined) {
      polityParentMap.set(info.polityId, info.parentPolityId)
    }
  }

  // 各 Province の chain を構築する。
  // 1. Province を所有する House を provinceToHouse から取得
  // 2. その House の所有 Polity (terminal) を houseToPolityId から取得
  // 3. terminal Polity の祖先を辿り、root → terminal の順で contract を作る
  // 4. 中間契約の taxRateToGrantor は 0.3 で固定 (簡略化、後で config 化可能)
  const INTERMEDIATE_TAX_RATE = 0.3
  for (const province of provinces) {
    const houseId = provinceToHouse.get(province.id)
    if (!houseId) continue
    const terminalPolityId = houseToPolityId.get(houseId)
    if (!terminalPolityId) continue

    // terminal から root へ祖先列を作る
    const polityChain: PolityId[] = [terminalPolityId]
    let cursor: PolityId | undefined = polityParentMap.get(terminalPolityId)
    while (cursor !== undefined) {
      polityChain.push(cursor)
      cursor = polityParentMap.get(cursor)
    }
    polityChain.reverse() // root → terminal の順

    // chain の各段に LandContract を作る
    const contractIds: LandContractId[] = []
    let prevContractId: LandContractId | undefined = undefined
    for (let depth = 0; depth < polityChain.length; depth++) {
      const granteePolityId = polityChain[depth]!
      const contractId = ('lc-' + nextLandContractId) as LandContractId
      nextLandContractId++

      const contract: LandContract = {
        id: contractId,
        provinceId: province.id,
        granteePolityId,
        terms: {
          taxRateToGrantor: prevContractId === undefined ? 0 : INTERMEDIATE_TAX_RATE,
        },
        ...(prevContractId === undefined
          ? { rootAuthorityId: ROOT_WORLD }
          : { parentContractId: prevContractId }),
      }
      landContractsRecord[contractId] = contract
      contractIds.push(contractId)

      const existingGrantee = landContractIndex.byGranteePolity[granteePolityId] ?? []
      landContractIndex.byGranteePolity[granteePolityId] = [...existingGrantee, contractId]

      if (prevContractId !== undefined) {
        landContractIndex.byParent[prevContractId] = contractId
      }
      prevContractId = contractId
    }
    landContractIndex.byProvince[province.id] = contractIds
    provinceTerminalPolityCache[province.id] = terminalPolityId
  }

  // polityIndex.byOwnerHouse
  const polityIndex: PolityIndex = { byOwnerHouse: {} }
  for (const polity of polities) {
    if (polity.ownerHouseId === undefined) continue
    const existing = polityIndex.byOwnerHouse[polity.ownerHouseId] ?? []
    polityIndex.byOwnerHouse[polity.ownerHouseId] = [...existing, polity.id]
  }

  // AnonymousHouse (system house) を 1 つ追加。全 placeholder Person の所属先。
  const anonymousHouse: House = {
    id: ANONYMOUS_HOUSE_ID,
    name: 'Anonymous Placeholder House',
    active: true,
    kind: 'system',
    memberIds: [],
    cadetHouseIds: [],
    legacyPrestige: 0,
    wealth: 0,
    seatProvinceId: provinceList[0]?.id ?? ('' as ProvinceId),
  }
  housesRecord[ANONYMOUS_HOUSE_ID] = anonymousHouse

  // 各 Province 用 placeholder Person + bailiff ProvinceOfficeAssignment
  const provinceOfficeAssignments: Record<ProvinceOfficeAssignmentId, ProvinceOfficeAssignment> = {}
  const provinceOfficeIndex: ProvinceOfficeIndex = {
    byProvince: {},
    byHolderPerson: {},
    byAppointingPolity: {},
  }
  let nextProvinceOfficeAssignmentId = 0
  let nextPlaceholderIndex = 0
  const placeholderMembers: PersonId[] = []
  for (const province of provinces) {
    const terminalPolityId = provinceTerminalPolityCache[province.id]
    if (!terminalPolityId) continue
    const placeholderId = ('pe-anon-' + nextPlaceholderIndex) as PersonId
    nextPlaceholderIndex++
    const placeholder: Person = {
      id: placeholderId,
      name: 'Anonymous',
      sex: 'male',
      age: 30,
      alive: true,
      kind: 'placeholder',
      houseId: ANONYMOUS_HOUSE_ID,
      childIds: [],
      birthStatus: 'unknown',
      abilities: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
      aptitudes: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
      traits: { ambition: 0, caution: 0 },
      legacyPrestige: 0,
      wealth: 0,
      attitudes: {},
    }
    personsRecord[placeholderId] = placeholder
    placeholderMembers.push(placeholderId)

    const officeAssignmentId = ('po-' +
      nextProvinceOfficeAssignmentId) as ProvinceOfficeAssignmentId
    nextProvinceOfficeAssignmentId++
    const assignment: ProvinceOfficeAssignment = {
      id: officeAssignmentId,
      provinceId: province.id,
      role: 'bailiff',
      holderPersonId: placeholderId,
      appointingPolityId: terminalPolityId,
      active: true,
      startYear: 1,
      startMonth: 1,
      unpaidCount: 0,
    }
    provinceOfficeAssignments[officeAssignmentId] = assignment
    provinceOfficeIndex.byProvince[province.id] = officeAssignmentId
    const holderSlot = provinceOfficeIndex.byHolderPerson[placeholderId] ?? []
    provinceOfficeIndex.byHolderPerson[placeholderId] = [...holderSlot, officeAssignmentId]
    const politySlot = provinceOfficeIndex.byAppointingPolity[terminalPolityId] ?? []
    provinceOfficeIndex.byAppointingPolity[terminalPolityId] = [...politySlot, officeAssignmentId]
  }
  housesRecord[ANONYMOUS_HOUSE_ID] = {
    ...anonymousHouse,
    memberIds: placeholderMembers,
  }

  const world: WorldState = {
    currentYear: 1,
    currentMonth: 1,
    provinces: provincesRecord,
    polities: politiesRecord,
    houses: housesRecord,
    persons: personsRecord,
    activePlots: {},
    popGroups: popGroupsRecord,
    organizationShares,
    officeAssignments: officeState.officeAssignments,
    landContracts: landContractsRecord,
    provinceOfficeAssignments,
    shareIndex,
    officeIndex: officeState.officeIndex,
    landContractIndex,
    provinceTerminalPolityCache,
    provinceOfficeIndex,
    polityIndex,
    nextOrganizationShareId,
    nextOfficeAssignmentId: officeState.nextOfficeAssignmentId,
    nextLandContractId,
    nextProvinceOfficeAssignmentId,
  }

  return { world, rng }
}
