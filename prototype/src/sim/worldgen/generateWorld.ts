import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import type {
  ProvinceId,
  HouseId,
  PolityId,
  PersonId,
  PopGroupId,
  StateRegionId,
  HoldingId,
  HoldingOfficeAssignmentId,
  HoldingImprovementId,
} from '../types/ids'
import {
  newPopGroupId,
  createPolityId,
  createHouseId,
  createHoldingId,
  createPersonId,
  createHoldingImprovementId,
} from '../types/ids'
import type { Province } from '../types/province'
import type { House } from '../types/house'
import type { Polity } from '../types/polity'
import type { Person } from '../types/person'
import type { PopGroup } from '../types/popGroup'
import type { StateRegion } from '../types/stateRegion'
import type { HouseShare, HouseShareIndex } from '../types/office'
import type { HouseShareId, LandContractId } from '../types/ids'
import type {
  LandContract,
  LandContractIndex,
  ProvinceTerminalPolityCache,
  PolityIndex,
  Holding,
  HoldingTerminalPolityCache,
  HoldingOfficeAssignment,
  HoldingOfficeIndex,
} from '../types/landContract'
import { ROOT_WORLD } from '../types/landContract'
import type { HoldingImprovement, HoldingImprovementKind } from '../types/holdingImprovement'
import { PLACEHOLDER_PERSON_ID } from '../types/person'
import { createRng, randomInt, randomFloat } from '../rng/rng'
import { generateProvinces } from './generateProvinces'
import { distributePolities } from './distributePolities'
import { distributeHouses } from './distributeHouses'
import { generatePersons } from './generatePersons'
import { samplePerson } from '../helpers/personFactory'
import { pickNameBySex } from './nameGenerators'
import {
  houseName,
  polityName,
  pickUniqueName,
  houseNamePool,
  polityNamePool,
  provinceNamePool,
  provinceName,
  stateNamePool,
  stateName,
} from './nameGenerators'
import { defaultConfig } from '../config/defaultConfig'
import { computeInitialIdIndices } from '../tick/context'
import { defaultMapConfig } from './mapConfig'
import { clamp } from '../utils/math'
import { polityAttitudeKey, houseAttitudeKey, personAttitudeKey } from '../helpers/attitudeHelpers'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getRoleScoreFromAbilities } from '../selectors/abilitySelectors'
import {
  computeHoldingOccupationCapacity,
  canBuildHoldingImprovementPure,
} from '../selectors/holdingImprovementSelectors'
import { WORLD_PRESETS, DEFAULT_PRESET } from './worldPresets'
import type { WorldPreset, WorldPresetName } from './worldPresets'
import type { NamePoolService } from '../namegen/namePoolTypes'
import { seedInitialDecisions } from './generateWorldSeeding'
export function generateWorld(
  seedText: string,
  presetName?: WorldPresetName,
  namePoolService?: NamePoolService,
): { world: WorldState; rng: RngState } {
  let rng = createRng(seedText)

  const preset = WORLD_PRESETS[presetName ?? DEFAULT_PRESET]

  const {
    provinces,
    stateCenters,
    rng: rng0,
  } = generateProvinces(rng, defaultMapConfig, preset, namePoolService)
  rng = rng0

  // Generate StateRegion records
  const statesRecord: Record<StateRegionId, StateRegion> = {}
  const usedStateNameKeys = new Set<string>()
  const statePool = stateNamePool()

  for (let i = 0; i < stateCenters.length; i++) {
    const center = stateCenters[i]!
    const provinceIdsInState = provinces
      .filter((p) => (p.stateId as string) === (center.id as string))
      .map((p) => p.id)

    let sNameKey: string
    if (namePoolService) {
      const { value: key, rng: rS } = namePoolService.pickUniqueNameKey(
        rng,
        usedStateNameKeys,
        {
          nameCultureId: 'western',
          category: 'state',
          path: ['common'],
        },
        'state',
        i,
      )
      rng = rS
      sNameKey = key
    } else {
      const { name, rng: rS } = pickUniqueName(statePool, usedStateNameKeys, stateName, i, rng)
      rng = rS
      sNameKey = name
    }

    statesRecord[center.id] = {
      id: center.id,
      nameKey: sNameKey,
      provinceIds: provinceIdsInState,
      centerX: center.x,
      centerY: center.y,
    }
  }

  const { assignments, rng: rng1 } = distributePolities(provinces, preset.kingdoms, rng)
  rng = rng1

  // Compute housesPerKingdom from the polity hierarchy logic
  // (must match generatePolityHierarchy's calculation)
  const duchiesPerK = Math.floor(preset.duchies / preset.kingdoms)
  const extraD = preset.duchies % preset.kingdoms
  const countiesPerK = Math.floor(preset.counties / preset.kingdoms)
  const extraC = preset.counties % preset.kingdoms
  const housesPerKingdom =
    1 + (duchiesPerK + (extraD > 0 ? 1 : 0)) + (countiesPerK + (extraC > 0 ? 1 : 0))
  const {
    houseProvinces,
    housePolity,
    rng: rng2,
  } = distributeHouses(provinces, assignments, preset.kingdoms, housesPerKingdom, rng)
  rng = rng2

  const { persons, rng: rng3 } = generatePersons(
    houseProvinces,
    housePolity,
    defaultConfig,
    rng,
    namePoolService,
  )
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

  // terrain / features は generateProvinces で確定済み（旧 habitability 後付けパスは削除）。
  // provinces の id 昇順ソートは下流の決定性のため維持する。
  provinces.sort((a, b) => a.id.localeCompare(b.id))

  const houses: House[] = []
  const sortedHouseIds = Array.from(houseProvinces.keys()).sort()

  const usedPolityNameKeys = new Set<string>()
  const usedHouseNameKeys = new Set<string>()

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
      // terrain の settlement suitability が最も高い Province を seat に選ぶ（§3）。
      // 同点時は sortedProvinceIds[0] 初期値 + 昇順走査で ProvinceId 昇順を担保する。
      const sortedProvinceIds = [...provinceIds].sort()
      const firstId = sortedProvinceIds[0]!
      let bestId = firstId
      let bestSuitability =
        defaultConfig.provinceTerrainSettlementSuitability[provinceMap.get(firstId)!.terrain]
      for (let i = 1; i < sortedProvinceIds.length; i++) {
        const pid = sortedProvinceIds[i]!
        const prov = provinceMap.get(pid)
        if (!prov) continue
        const suitability = defaultConfig.provinceTerrainSettlementSuitability[prov.terrain]
        if (suitability > bestSuitability) {
          bestSuitability = suitability
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

    let hNameKey: string
    if (namePoolService) {
      const { value: key, rng: rH } = namePoolService.pickUniqueNameKey(
        rng,
        usedHouseNameKeys,
        {
          nameCultureId: 'western',
          category: 'house',
          path: ['noble'],
        },
        'house',
        houseIndex,
      )
      rng = rH
      hNameKey = key
    } else {
      const { name, rng: rH } = pickUniqueName(
        houseNamePool(),
        usedHouseNameKeys,
        houseName,
        houseIndex,
        rng,
      )
      rng = rH
      hNameKey = name
    }

    const houseObj: House = {
      id: houseId,
      nameKey: hNameKey,
      active: true,
      memberIds,
      deceasedMemberIds: [],
      cadetHouseIds: [],
      legacyPrestige,
      wealth,
      seatProvinceId,
    }

    houses.push(houseObj)
  }

  // v0.20: Generate polity hierarchy dynamically from preset.
  type PolityInfo = { polityId: PolityId; rank: 2 | 3 | 4; parentPolityId?: PolityId }

  function generatePolityHierarchy(preset: WorldPreset): {
    map: Map<string, PolityInfo>
    housesPerKingdom: number
  } {
    const map = new Map<string, PolityInfo>()
    let polityCounter = 0
    const { kingdoms, duchies, counties } = preset

    const duchiesPerKingdom = Math.floor(duchies / kingdoms)
    const extraDuchies = duchies % kingdoms
    const countiesPerKingdom = Math.floor(counties / kingdoms)
    const extraCounties = counties % kingdoms

    // housesPerKingdom must accommodate the kingdom with the most polities (= most extras)
    const maxDuchiesInOneKingdom = duchiesPerKingdom + (extraDuchies > 0 ? 1 : 0)
    const maxCountiesInOneKingdom = countiesPerKingdom + (extraCounties > 0 ? 1 : 0)
    const housesPerKingdom = 1 + maxDuchiesInOneKingdom + maxCountiesInOneKingdom

    for (let k = 0; k < kingdoms; k++) {
      const kingdomHouseBase = k * housesPerKingdom
      const kingdomPolityId = createPolityId('c', polityCounter++)

      // Kingdom owner = first house in this kingdom's block
      map.set(createHouseId('h', kingdomHouseBase), {
        polityId: kingdomPolityId,
        rank: 2,
      })

      const myDuchies = duchiesPerKingdom + (k < extraDuchies ? 1 : 0)

      let houseOffset = 1
      const duchyPolityIds: PolityId[] = []

      // Duchies for this kingdom
      for (let d = 0; d < myDuchies; d++) {
        const duchyPolityId = createPolityId('c', polityCounter++)
        duchyPolityIds.push(duchyPolityId)
        const houseId = createHouseId('h', kingdomHouseBase + houseOffset++)
        map.set(houseId, {
          polityId: duchyPolityId,
          rank: 3,
          parentPolityId: kingdomPolityId,
        })
      }

      // Counties for this kingdom, distributed among its duchies.
      // Pad with extra counties if myDuchies + myCounties + 1 < housesPerKingdom
      // so that every House in the block has a Polity.
      const targetCounties = housesPerKingdom - 1 - myDuchies
      for (let c = 0; c < targetCounties; c++) {
        const parentDuchy =
          duchyPolityIds.length > 0 ? duchyPolityIds[c % duchyPolityIds.length]! : kingdomPolityId
        const countyPolityId = createPolityId('c', polityCounter++)
        const houseId = createHouseId('h', kingdomHouseBase + houseOffset++)
        map.set(houseId, {
          polityId: countyPolityId,
          rank: 4,
          parentPolityId: parentDuchy,
        })
      }
    }

    return { map, housesPerKingdom }
  }

  const { map: polityHierarchy } = generatePolityHierarchy(preset)

  const polities: Polity[] = []

  // Generate Polity for each House.
  const houseToPolityId = new Map<HouseId, PolityId>()
  const polityToOwnerHouse = new Map<PolityId, HouseId>()
  let polityNameCounter = 0
  for (const house of houses) {
    const info = polityHierarchy.get(house.id)
    if (!info) continue
    houseToPolityId.set(house.id, info.polityId)
    polityToOwnerHouse.set(info.polityId, house.id)

    const { value: treasury, rng: r1 } = randomInt(rng, 100, 300)
    const { value: legacyPrestige, rng: r2 } = randomInt(r1, 20, 60)
    rng = r2

    let cNameKey: string
    if (namePoolService) {
      const { value: key, rng: rC } = namePoolService.pickUniqueNameKey(
        rng,
        usedPolityNameKeys,
        {
          nameCultureId: 'western',
          category: 'polity',
          path: ['default'],
        },
        'polity',
        polityNameCounter,
      )
      rng = rC
      cNameKey = key
    } else {
      const { name, rng: rC } = pickUniqueName(
        polityNamePool(),
        usedPolityNameKeys,
        polityName,
        polityNameCounter,
        rng,
      )
      rng = rC
      cNameKey = name
    }
    polityNameCounter++

    const capitalProvinceId = house.seatProvinceId

    const newPolityObj: Polity = {
      id: info.polityId,
      nameSource: { kind: 'pool', nameKey: cNameKey },
      treasury,
      legacyPrestige,
      adminPower: 50,
      active: true,
      capitalProvinceId,
      rank: info.rank,
      ownerHouseId: house.id,
      origin: { kind: 'worldgen' },
    }

    polities.push(newPolityObj)
  }

  const visited = new Set<ProvinceId>()
  const queue = new Array<string>()

  // Compute polityControl values for Holdings (Province no longer stores polityControl)
  const controlMap = new Map<ProvinceId, number>()

  for (const polity of polities) {
    const capProv = provinceMap.get(polity.capitalProvinceId)
    if (!capProv) {
      for (const p of provinces) {
        if (assignments.get(p.id) === polity.id) {
          controlMap.set(p.id, 30)
        }
      }
      continue
    }

    for (const p of provinces) {
      if (assignments.get(p.id) === polity.id) {
        controlMap.set(p.id, 30)
      }
    }

    const distMap = new Map<ProvinceId, number>()
    distMap.set(capProv.id, 0)
    controlMap.set(capProv.id, 100)

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
          controlMap.set(neighborId, maxControl)
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

  // §6.1 Person attitude initialization
  const updatedPersons = persons.map((p) => {
    if (!p.alive) return p
    let attitudes = { ...p.attitudes }
    if (p.houseId) {
      const houseKey = houseAttitudeKey(p.houseId)
      const { value: aff2, rng: r3 } = randomInt(rng, 30, 80)
      const { value: res2, rng: r4 } = randomInt(r3, 20, 70)
      rng = r4
      attitudes = {
        ...attitudes,
        [houseKey]: { affection: aff2, respect: res2 },
      }
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
  const popGroupsRecord: Record<PopGroupId, PopGroup> = {}

  let officeState = {
    currentYear: 1,
    currentWeekOfYear: 1,
    absoluteWeek: 48,
    provinces: provincesRecord,
    polities: politiesRecord,
    houses: housesRecord,
    persons: personsRecord,
    livingPersonIds: (Object.keys(personsRecord) as PersonId[])
      .filter((id) => personsRecord[id]?.alive)
      .sort(),
    activePlots: {},
    popGroups: popGroupsRecord,
    houseShares: {},
    politicalRights: {},
    politicalRightIndex: { byPolity: {}, byHolder: {}, byTarget: {} },
    nextPoliticalRightId: 0,
    personReputations: {},
    personReputationIndex: { byPerson: {} },
    nextPersonReputationId: 0,
    officeAssignments: {},
    officeIndex: { byOrganization: {}, byHolderPerson: {} },
    nextHouseShareId: 0,
    nextOfficeAssignmentId: 0,
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {}, byPolity: {} },
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    // v0.27 HoldingImprovement
    holdingImprovements: {},
    holdingImprovementIndex: { byHolding: {} },
    nextHoldingImprovementId: 0,
    // v0.26 Project system
    projects: {},
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
    diplomaticPlays: {},
    diplomaticOffers: {},
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    // v0.38 Chronicle System
    chronicleEntries: {},
    chronicleIndex: { byPerson: {}, byHouse: {}, byPolity: {}, byProvince: {}, byHolding: {} },
    nextChronicleEntryId: 0,
    nextProjectId: 0,
    nextDiplomaticPlayId: 0,
    nextDiplomaticOfferId: 0,
    nextPressureId: 1,
    // v0.32 Clan
    clans: {},
    nextClanId: 1,
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

  // v0.42c §15.1: Polity share は生成しない (Polity Influence は read-model — spec v0.42)。
  // Initialize shares
  const houseShares: Record<HouseShareId, HouseShare> = {}
  const houseShareIndex: HouseShareIndex = { byHouse: {}, byHolderPerson: {} }
  let nextHouseShareId = 0

  function addShare(houseId: HouseId, holderPersonId: PersonId, rawPower: number): void {
    if (rawPower <= 0) return
    const id = `os-${nextHouseShareId}` as HouseShareId
    nextHouseShareId++
    const share: HouseShare = { id, houseId, holderPersonId, rawPower }
    houseShares[id] = share

    const existingByHouse = houseShareIndex.byHouse[houseId] ?? []
    const existingByHolder = houseShareIndex.byHolderPerson[holderPersonId] ?? []
    houseShareIndex.byHouse[houseId] = [...existingByHouse, id]
    houseShareIndex.byHolderPerson[holderPersonId] = [...existingByHolder, id]
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

      // 調査 §1.2: stat 項は canonical な computeHouseShareRawPower (shareUpdateSystem)
      //   と同じく governance/warCommand role スコアを /10 して合算する。旧 inline は手書きの
      //   ability 加重和 (= ROLE_WEIGHTS.governance + .warCommand を複製) で /10 が欠落しており、
      //   stat 項が 10x = 全体で 3.8-4.9x 水増しになっていた。年1末の shareUpdateSystem が
      //   上書きするまで houseSurplusDistributionSystem が歪んだ share 比で分配していた。
      const rawPower =
        config.houseShareBase +
        (isLeader ? config.houseShareLeaderBonus : 0) +
        (hasOffice ? config.houseShareOfficeBonus : 0) +
        person.legacyPrestige * config.houseSharePrestigeFactor +
        person.wealth * config.houseShareWealthFactor +
        (getRoleScoreFromAbilities(person.abilities, 'governance') / 10 +
          getRoleScoreFromAbilities(person.abilities, 'warCommand') / 10) *
          config.houseShareStatFactor

      addShare(house.id, personId, rawPower)
    }
  }

  // v0.16: LandContract chain, AnonymousHouse, placeholder persons, ProvinceOfficeAssignments を生成
  const landContractsRecord: Record<LandContractId, LandContract> = {}
  const landContractIndex: LandContractIndex = {
    byHolding: {},
    byGranteePolity: {},
    byParent: {},
  }
  const provinceTerminalPolityCache: ProvinceTerminalPolityCache = {}
  let nextLandContractId = 0

  // Build reverse lookup of polity rank and parent.
  const polityRankMap = new Map<PolityId, 2 | 3 | 4>()
  const polityParentMap = new Map<PolityId, PolityId>()
  for (const info of polityHierarchy.values()) {
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
  // 調査 §4.1: byProvince index は撤去済。worldgen 内で province→chain を一時的に保持する
  // local map (後段の holding 紐付けで使用)。
  const provinceChainMap = new Map<ProvinceId, LandContractId[]>()
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
    provinceChainMap.set(province.id, contractIds)
    provinceTerminalPolityCache[province.id] = terminalPolityId
  }

  // v0.20-b1: Holding 生成 (複数 Holding / Province)
  const holdingsRecord: Record<HoldingId, Holding> = {}
  const holdingTerminalPolityCache: HoldingTerminalPolityCache = {}
  const holdingOfficeAssignments: Record<HoldingOfficeAssignmentId, HoldingOfficeAssignment> = {}
  const holdingOfficeIndex: HoldingOfficeIndex = {
    byHolding: {},
    byHolderPerson: {},
    byAppointingPolity: {},
  }
  let nextHoldingId = 0
  let nextHoldingOfficeAssignmentId = 0

  for (const province of provinces) {
    // Determine holding count from preset
    let holdingCount: number
    if (preset.holdingsPerProvinceMin === preset.holdingsPerProvinceMax) {
      holdingCount = preset.holdingsPerProvinceMin
    } else {
      const { value: hc, rng: r } = randomInt(
        rng,
        preset.holdingsPerProvinceMin,
        preset.holdingsPerProvinceMax,
      )
      rng = r
      holdingCount = hc
    }

    // Determine if this province gets a city (§14.4)
    const cityProvinceChance = 0.2
    const minHoldingsForCity = 3
    let hasCity = false
    if (holdingCount >= minHoldingsForCity) {
      const { value: cityRoll, rng: r2 } = randomFloat(rng)
      rng = r2
      hasCity = cityRoll < cityProvinceChance
    }

    const holdingControl = controlMap.get(province.id) ?? 0
    const holdingIds: HoldingId[] = []
    // §2.3/§4.1: Holding 名は同一 Province 内でのみ一意。Province 自身の nameKey は
    // seed しない (Province 名と Holding 名の衝突は許容)。
    const usedHoldingNameKeysInProvince = new Set<string>()

    for (let i = 0; i < holdingCount; i++) {
      const holdingId = createHoldingId(nextHoldingId++)

      // Determine kind and weight
      const isCity = hasCity && i === holdingCount - 1
      let kind: 'manor' | 'city'
      let weight: number

      if (isCity) {
        kind = 'city'
        const { value: w, rng: rw } = randomFloat(rng)
        rng = rw
        weight = 2.0 + w * 1.0
      } else {
        kind = 'manor'
        weight = 1.0
      }

      // landQuality: randomFloat(0.6, 1.4)
      const { value: lqRoll, rng: rlq } = randomFloat(rng)
      rng = rlq
      const landQuality = 0.6 + lqRoll * 0.8

      // §4.1: Holding 命名。manor=province pool / city=city pool。required のため
      // literal 構築時に確定させる。
      let holdingNameKey: string
      if (namePoolService) {
        const { value: key, rng: rN } = namePoolService.pickUniqueNameKey(
          rng,
          usedHoldingNameKeysInProvince,
          {
            nameCultureId: 'western',
            category: kind === 'city' ? 'city' : 'province',
            path: ['common'],
          },
          'holding',
          i,
        )
        rng = rN
        holdingNameKey = key
      } else {
        const { name, rng: rN } = pickUniqueName(
          provinceNamePool(),
          usedHoldingNameKeysInProvince,
          provinceName,
          i,
          rng,
        )
        rng = rN
        holdingNameKey = name
      }

      const holding: Holding = {
        id: holdingId,
        provinceId: province.id,
        nameKey: holdingNameKey,
        kind,
        polityControl: holdingControl,
        landQuality,
        weight,
      }
      holdingsRecord[holdingId] = holding
      holdingIds.push(holdingId)

      const provinceChainIds = provinceChainMap.get(province.id) ?? []
      if (i === 0) {
        for (const cid of provinceChainIds) {
          const contract = landContractsRecord[cid]
          if (contract) {
            landContractsRecord[cid] = { ...contract, holdingId }
          }
        }
        landContractIndex.byHolding[holdingId] = provinceChainIds
      } else {
        const newChainIds: LandContractId[] = []
        const oldToNew = new Map<LandContractId, LandContractId>()
        for (const oldCid of provinceChainIds) {
          const newCid = ('lc-' + nextLandContractId) as LandContractId
          nextLandContractId++
          oldToNew.set(oldCid, newCid)
          newChainIds.push(newCid)
        }
        for (let j = 0; j < provinceChainIds.length; j++) {
          const oldContract = landContractsRecord[provinceChainIds[j]!]
          if (!oldContract) continue
          const newCid = newChainIds[j]!
          const parentId = oldContract.parentContractId
            ? (oldToNew.get(oldContract.parentContractId) ?? oldContract.parentContractId)
            : undefined
          const newContract: LandContract = {
            ...oldContract,
            id: newCid,
            holdingId,
            ...(parentId !== undefined ? { parentContractId: parentId } : {}),
          }
          landContractsRecord[newCid] = newContract
          const granteeSlot = landContractIndex.byGranteePolity[newContract.granteePolityId] ?? []
          landContractIndex.byGranteePolity[newContract.granteePolityId] = [...granteeSlot, newCid]
          if (parentId !== undefined) {
            landContractIndex.byParent[parentId] = newCid
          }
        }
        landContractIndex.byHolding[holdingId] = newChainIds
      }

      // Terminal polity cache
      const terminalPolityId = provinceTerminalPolityCache[province.id]
      if (terminalPolityId) {
        holdingTerminalPolityCache[holdingId] = terminalPolityId

        // Create placeholder bailiff for each holding
        const hoaId = ('ho-' + nextHoldingOfficeAssignmentId) as HoldingOfficeAssignmentId
        nextHoldingOfficeAssignmentId++
        const hoa: HoldingOfficeAssignment = {
          id: hoaId,
          holdingId,
          role: 'bailiff',
          holderPersonId: PLACEHOLDER_PERSON_ID,
          appointingPolityId: terminalPolityId,
          active: true,
          startWeek: 1,
          unpaidCount: 0,
          contractedRemittanceRate: defaultConfig.defaultContractedRemittanceRate,
          expectedFeeRate: defaultConfig.defaultExpectedBailiffFeeRate,
        }
        holdingOfficeAssignments[hoaId] = hoa
        holdingOfficeIndex.byHolding[holdingId] = hoaId
        const politySlot = holdingOfficeIndex.byAppointingPolity[terminalPolityId] ?? []
        holdingOfficeIndex.byAppointingPolity[terminalPolityId] = [...politySlot, hoaId]
      }
    }

    // Update province with all holding IDs
    provincesRecord[province.id] = {
      ...provincesRecord[province.id]!,
      holdingIds,
    }
  }

  // v0.27 Phase C: Initial HoldingImprovement placement (§17)
  const holdingImprovements: Record<HoldingImprovementId, HoldingImprovement> = {}
  const holdingImprovementIndexByHolding: Record<string, HoldingImprovementId[]> = {}
  let nextHoldingImprovementId = 0

  // v0.33 §10.4: 候補を新 ImprovementKind に置換。数値はバランス調整で変更可。
  const initialImprovementChances: Record<
    string,
    { kind: HoldingImprovementKind; probability: number }[]
  > = {
    manor: [
      { kind: 'field_system', probability: 0.4 },
      { kind: 'pastoral_infrastructure', probability: 0.2 },
      { kind: 'irrigation_infrastructure', probability: 0.3 },
      { kind: 'storage_infrastructure', probability: 0.15 },
      { kind: 'transport_infrastructure', probability: 0.15 },
    ],
    city: [
      { kind: 'market_infrastructure', probability: 0.4 },
      { kind: 'workshop_infrastructure', probability: 0.25 },
      { kind: 'storage_infrastructure', probability: 0.25 },
      { kind: 'transport_infrastructure', probability: 0.25 },
    ],
  }

  for (const holding of Object.values(holdingsRecord)) {
    if (!holding) continue
    const province = provincesRecord[holding.provinceId]
    if (!province) continue
    const chances = initialImprovementChances[holding.kind] ?? []
    for (const cfg of chances) {
      // §10.4: canBuild を先に判定し、建設可能な kind に対してのみ randomFloat を消費する
      // （建設不可 kind では draw を消費しない → 同一バージョン・同一 seed の決定性を保証）
      if (
        !canBuildHoldingImprovementPure(
          holding.kind,
          province.terrain,
          province.features,
          0,
          cfg.kind,
          defaultConfig,
        )
      ) {
        continue
      }
      const { value: roll, rng: rNext } = randomFloat(rng)
      rng = rNext
      if (roll < cfg.probability) {
        const impId = createHoldingImprovementId(nextHoldingImprovementId++)
        holdingImprovements[impId] = {
          id: impId,
          holdingId: holding.id,
          kind: cfg.kind,
          level: 1,
          condition: 100,
          createdWeek: 1,
        }
        const slot = holdingImprovementIndexByHolding[holding.id as string] ?? []
        slot.push(impId)
        holdingImprovementIndexByHolding[holding.id as string] = slot
      }
    }
  }

  // polityIndex.byOwnerHouse
  const polityIndex: PolityIndex = { byOwnerHouse: {} }
  for (const polity of polities) {
    if (polity.ownerHouseId === undefined) continue
    const existing = polityIndex.byOwnerHouse[polity.ownerHouseId] ?? []
    polityIndex.byOwnerHouse[polity.ownerHouseId] = [...existing, polity.id]
  }

  // v0.17.2: 全 Province の placeholder bailiff は単一の singleton Person を共有する。
  // singleton Person は houseless (no houseId)。
  const placeholderSingleton: Person = {
    id: PLACEHOLDER_PERSON_ID,
    nameKey: 'anonymous',
    sex: 'male',
    age: 30,
    lifeStage: 'mature_adulthood',
    alive: true,
    kind: 'placeholder',
    childIds: [],
    birthStatus: 'unknown',
    abilities: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
    aptitudes: { valor: 0, command: 0, numeracy: 0, learning: 0, charisma: 0, insight: 0 },
    traits: { ambition: 0, caution: 0 },
    legacyPrestige: 0,
    wealth: 0,
    attitudes: {},
  }
  personsRecord[PLACEHOLDER_PERSON_ID] = placeholderSingleton

  // Generate initial unaffiliated persons proportional to holdings count
  const holdingsCount = Object.keys(holdingsRecord).length
  const initialHouselessCount = Math.ceil(holdingsCount * defaultConfig.houselessPersonsPerHolding)
  if (initialHouselessCount > 0) {
    let maxPeIndex = 0
    for (const pid of Object.keys(personsRecord)) {
      if (pid.startsWith('pe-')) {
        const n = parseInt(pid.slice(3), 10)
        if (!isNaN(n) && n > maxPeIndex) maxPeIndex = n
      }
    }
    let peIndex = maxPeIndex + 1
    const occupations: Array<'wanderer' | 'merchant' | 'scholar' | 'mercenary' | 'adventurer'> = [
      'wanderer',
      'merchant',
      'scholar',
      'mercenary',
      'adventurer',
    ]
    for (let i = 0; i < initialHouselessCount; i++) {
      const personId = createPersonId('pe', peIndex)
      peIndex++

      const { value: sexRoll, rng: rng_s } = randomFloat(rng)
      rng = rng_s
      const sex: 'male' | 'female' = sexRoll < 0.5 ? 'male' : 'female'

      let unNameKey: string
      if (namePoolService) {
        const { value: key, rng: rng_n } = namePoolService.pickNameKey(rng, {
          nameCultureId: 'western',
          category: 'person',
          path: [sex === 'male' ? 'male' : 'female'],
        })
        rng = rng_n
        unNameKey = key
      } else {
        const { name, rng: rng_n } = pickNameBySex(sex, rng)
        rng = rng_n
        unNameKey = name
      }

      const { value: age, rng: rng_a } = randomInt(rng, defaultConfig.adultAge, 45)
      rng = rng_a
      const { value: ambition, rng: rng_am } = randomFloat(rng)
      rng = rng_am
      const { value: caution, rng: rng_ca } = randomFloat(rng)
      rng = rng_ca
      const { value: prestige, rng: rng_pr } = randomInt(rng, 0, 20)
      rng = rng_pr
      const { value: person, rng: rng_sp } = samplePerson(rng, defaultConfig, {
        id: personId,
        nameKey: unNameKey,
        sex,
        age,
        birthStatus: 'unknown',
        traits: { ambition, caution },
        legacyPrestige: prestige,
        wealth: 0,
      })
      rng = rng_sp
      const occupation = occupations[i % occupations.length]!
      const personWithKey: Person = { ...person, occupation, lastHouseTransferYear: 1 }
      personsRecord[personId] = personWithKey
    }
  }

  // §6.3 POP generation (Holding-based, occupation capacity driven)
  const popIndexByHolding: Record<HoldingId, PopGroupId[]> = {}
  const { minPopSizeByClass } = defaultConfig

  for (const provinceBase of provinces) {
    const province = provincesRecord[provinceBase.id]!

    for (const holdingId of province.holdingIds) {
      const holding = holdingsRecord[holdingId]
      if (!holding) continue

      // v0.33 §10.5: capacity を selector と同じ pure helper で計算（base + improvement-derived）。
      // 配置済み improvement（この前段の loop で確定）と Province の terrain/features を引く。
      const seedImpIds = holdingImprovementIndexByHolding[holding.id as string] ?? []
      const seedImprovements: { kind: HoldingImprovementKind; level: number }[] = []
      for (const impId of seedImpIds) {
        const imp = holdingImprovements[impId]
        if (imp) seedImprovements.push({ kind: imp.kind, level: imp.level })
      }
      const agriCap = computeHoldingOccupationCapacity(
        holding.kind,
        holding.weight,
        holding.landQuality,
        province.terrain,
        province.features,
        seedImprovements,
        defaultConfig,
        'agriculture',
      )
      const urbanCap = computeHoldingOccupationCapacity(
        holding.kind,
        holding.weight,
        holding.landQuality,
        province.terrain,
        province.features,
        seedImprovements,
        defaultConfig,
        'urban_labor',
      )
      const eliteCap = computeHoldingOccupationCapacity(
        holding.kind,
        holding.weight,
        holding.landQuality,
        province.terrain,
        province.features,
        seedImprovements,
        defaultConfig,
        'elite_service',
      )

      const { value: fillPct, rng: rf1 } = randomInt(
        rng,
        defaultConfig.initialPopFillRatioMin,
        defaultConfig.initialPopFillRatioMax,
      )
      const fillRatio = fillPct / 100

      const { value: peasantWealth, rng: rp4 } = randomInt(rf1, 35, 60)
      const { value: townsmanWealth, rng: rp5 } = randomInt(rp4, 45, 70)
      const { value: noblesWealth, rng: rp6 } = randomInt(rp5, 50, 80)
      const { value: peasantUnrest, rng: rp7 } = randomInt(rp6, 10, 30)
      const { value: townsmanUnrest, rng: rp8 } = randomInt(rp7, 10, 25)
      const { value: noblesUnrest, rng: rp9 } = randomInt(rp8, 5, 25)
      rng = rp9

      const peasantsId = newPopGroupId(`pop-${holdingId as string}-peasants`)
      const townsmanId = newPopGroupId(`pop-${holdingId as string}-townsmen`)
      const noblesId = newPopGroupId(`pop-${holdingId as string}-nobles`)

      popGroupsRecord[peasantsId] = {
        id: peasantsId,
        holdingId,
        class: 'peasants',
        occupation: 'agriculture',
        size: Math.max(minPopSizeByClass.peasants, agriCap * fillRatio),
        wealth: peasantWealth,
        unrest: peasantUnrest,
        attitudes: {},
      }
      popGroupsRecord[townsmanId] = {
        id: townsmanId,
        holdingId,
        class: 'townsmen',
        occupation: 'urban_labor',
        size: Math.max(minPopSizeByClass.townsmen, urbanCap * fillRatio),
        wealth: townsmanWealth,
        unrest: townsmanUnrest,
        attitudes: {},
      }
      popGroupsRecord[noblesId] = {
        id: noblesId,
        holdingId,
        class: 'nobles',
        occupation: 'elite_service',
        size: Math.max(minPopSizeByClass.nobles, eliteCap * fillRatio),
        wealth: noblesWealth,
        unrest: noblesUnrest,
        attitudes: {},
      }

      popIndexByHolding[holdingId] = [peasantsId, townsmanId, noblesId]
    }
  }

  // §6.4 PopGroup attitude initialization (Holding-based)
  for (const popGroupId of Object.keys(popGroupsRecord) as PopGroupId[]) {
    const pop = popGroupsRecord[popGroupId]
    if (!pop) continue
    const holding = holdingsRecord[pop.holdingId]
    const province = holding ? provinceMap.get(holding.provinceId) : undefined
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

  // 調査 §4.5: next index を永続化。worldgen 完了時点の persons/houses/polities を
  // computeInitialIdIndices で走査し初期値を確定 (= 旧 createTickContext が初回 tick で
  // 算出していた値と完全一致させる)。
  const initialIdIndices = computeInitialIdIndices({
    persons: personsRecord,
    houses: housesRecord,
    polities: politiesRecord,
  })

  const world: WorldState = {
    currentYear: 1,
    currentWeekOfYear: 1,
    absoluteWeek: 48,
    provinces: provincesRecord,
    holdings: holdingsRecord,
    polities: politiesRecord,
    states: statesRecord,
    houses: housesRecord,
    persons: personsRecord,
    livingPersonIds: (Object.keys(personsRecord) as PersonId[])
      .filter((id) => personsRecord[id]?.alive)
      .sort(),
    // v0.45.1: 人口閾値の基準 (placeholder 除く初期生存人口)。preset 規模に閾値を比例させる
    worldgenLivingPersonsBaseline: (Object.keys(personsRecord) as PersonId[]).filter(
      (id) => personsRecord[id]?.alive && personsRecord[id]?.kind !== 'placeholder',
    ).length,
    activePlots: {},
    popGroups: popGroupsRecord,
    popIndex: { byHolding: popIndexByHolding },
    houseShares,
    officeAssignments: officeState.officeAssignments,
    landContracts: landContractsRecord,
    holdingOfficeAssignments,
    holdingOfficeIndex,
    houseShareIndex,
    officeIndex: officeState.officeIndex,
    landContractIndex,
    holdingTerminalPolityCache,
    polityIndex,
    factions: {},
    factionMemberships: {},
    factionIndex: { byLeader: {}, byMember: {}, byPolity: {} },
    // v0.27 HoldingImprovement
    holdingImprovements,
    holdingImprovementIndex: { byHolding: holdingImprovementIndexByHolding },
    nextHoldingImprovementId,
    // v0.26 Project system
    projects: {},
    projectIndex: {
      byOwner: {},
      byAim: {},
      byParentProject: {},
      byCreatorPerson: {},
      bySupervisorPerson: {},
      byRelatedEntity: {},
    },
    diplomaticPlays: {},
    diplomaticOffers: {},
    nextHouseShareId,
    nextOfficeAssignmentId: officeState.nextOfficeAssignmentId,
    nextLandContractId,
    nextHoldingOfficeAssignmentId,
    nextFactionId: 0,
    nextFactionMembershipId: 0,
    nextProjectId: 0,
    nextDiplomaticPlayId: 0,
    wars: {},
    warIndex: { byParticipant: {}, byOriginDiplomaticPlay: {} },
    regiments: {},
    regimentIndex: { byOwner: {}, byWar: {}, byHomeProvince: {}, byHomeHolding: {} },
    nextRegimentId: 0,
    battles: {},
    battleIndex: { byWar: {} },
    nextBattleId: 0,
    nextWarId: 0,
    nextDiplomaticOfferId: 0,
    nextPressureId: 1,
    // v0.29 Pressure
    pressures: {},
    pressureIndex: { byTarget: {}, bySource: {}, byDiplomaticPlay: {}, byProject: {} },
    // v0.38 Chronicle System
    chronicleEntries: {},
    chronicleIndex: { byPerson: {}, byHouse: {}, byPolity: {}, byProvince: {}, byHolding: {} },
    nextChronicleEntryId: 0,
    // v0.42 PoliticalRight (初期 worldgen では right を生成しない — all residual。spec §15.3)
    politicalRights: {},
    politicalRightIndex: { byPolity: {}, byHolder: {}, byTarget: {} },
    nextPoliticalRightId: 0,
    // v0.44 PersonReputation (初期 worldgen では生成しない — 成果由来のみ)
    personReputations: {},
    personReputationIndex: { byPerson: {} },
    nextPersonReputationId: 0,
    // v0.22 Goal/Aim system
    goals: {},
    aims: {},
    decisionReasons: {},
    goalIndex: { byOwner: {} },
    aimIndex: { byOwner: {}, byGoal: {} },
    nextGoalId: 0,
    nextAimId: 0,
    nextDecisionReasonId: 0,
    // v0.23 Task/ActivityLog
    tasks: {},
    taskIndex: { byAssignee: {}, byOwner: {}, byTarget: {} },
    personActivityLogs: {},
    personActivityLogIndex: { byPerson: {} },
    waitingAimIds: [],
    nextTaskId: 0,
    nextPersonActivityLogId: 0,
    nextPopGroupId: 0,
    // v0.32 Clan
    clans: {},
    nextClanId: 1,
    // 調査 §4.5: 永続化した next index (上で算出)
    nextPersonIndex: initialIdIndices.nextPersonIndex,
    nextHouseIndex: initialIdIndices.nextHouseIndex,
    nextPolityIndex: initialIdIndices.nextPolityIndex,
  }

  return seedInitialDecisions(world, seedText, rng)
}
