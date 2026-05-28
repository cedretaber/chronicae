import type { TickContext } from './context'
import { createSimEvent, makeHouseId, makePersonId } from './context'
import type { PersonId, HouseId, ProvinceId } from '../types/ids'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'
import type { RngState } from '../rng/rng'
import { randomFloat, randomInt, shuffle } from '../rng/rng'
import { getHouselessPersons } from '../selectors/availabilitySelectors'
import { createOfficeAssignment } from '../mutations/officeMutations'
import { initializeHouseShares } from './shareUpdateSystem'
import { samplePerson } from '../helpers/personFactory'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { createLogger } from '../debug/logger'
import { nameParam, entityRef } from '../types/event'

export function runHouseFoundingSystem(ctx: TickContext): TickContext {
  if (!ctx.config.houseFoundingEnabled) return ctx

  let currentCtx = ctx

  const candidateIds = getHouselessPersons(currentCtx.state).filter((pid) => {
    const person = currentCtx.state.persons[pid]
    if (!person) return false
    return isFoundingCandidate(currentCtx.state, currentCtx.config, person)
  })

  if (candidateIds.length === 0) return currentCtx

  const { value: shuffled, rng: rngAfterShuffle } = shuffle(currentCtx.rng, candidateIds)
  currentCtx = { ...currentCtx, rng: rngAfterShuffle }

  let foundedCount = 0
  const log = createLogger(currentCtx.config.debug)

  for (const candidateId of shuffled) {
    if (foundedCount >= currentCtx.config.houseFoundingMaxPerMonth) break

    const candidate = currentCtx.state.persons[candidateId]
    if (!candidate || !candidate.alive || candidate.houseId !== undefined) continue

    const { value: roll, rng: rollRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rollRng }
    if (roll >= currentCtx.config.houseFoundingMonthlyChance) continue

    const seatResult = determineSeatProvinceId(currentCtx.state, currentCtx.rng, candidateId)
    currentCtx = { ...currentCtx, rng: seatResult.rng }
    if (!seatResult.provinceId) continue

    const seatProvinceId = seatResult.provinceId

    let houseNameKey: string
    if (currentCtx.namePoolService) {
      const usedKeys = new Set(
        Object.values(currentCtx.state.houses)
          .filter((h): h is NonNullable<typeof h> => h !== undefined)
          .map((h) => h.nameKey),
      )
      const { value: key, rng: rngH } = currentCtx.namePoolService.pickUniqueNameKey(
        currentCtx.rng,
        usedKeys,
        { nameCultureId: 'western', category: 'house', path: ['noble'] },
        'house',
        Object.keys(currentCtx.state.houses).length,
      )
      currentCtx = { ...currentCtx, rng: rngH }
      houseNameKey = key
    } else {
      houseNameKey = `house_${Object.keys(currentCtx.state.houses).length}`
    }

    const { id: newHouseId, ctx: ctxWithHouseId } = makeHouseId(currentCtx)
    currentCtx = ctxWithHouseId

    const wealthTransfer = Math.floor(
      candidate.wealth * currentCtx.config.houseFoundingWealthTransferRate,
    )
    const houseLegacyPrestige = Math.min(
      100,
      Math.max(0, Math.floor(candidate.legacyPrestige * 0.5)),
    )

    const newHouse: House = {
      id: newHouseId,
      nameKey: houseNameKey,
      active: true,
      memberIds: [candidateId],
      deceasedMemberIds: [],
      founderId: candidateId,
      cadetHouseIds: [],
      legacyPrestige: houseLegacyPrestige,
      wealth: wealthTransfer,
      seatProvinceId,
    }

    const updatedCandidate = {
      ...candidate,
      houseId: newHouseId,
      wealth: candidate.wealth - wealthTransfer,
    }

    let state: WorldState = {
      ...currentCtx.state,
      houses: { ...currentCtx.state.houses, [newHouseId]: newHouse },
      persons: { ...currentCtx.state.persons, [candidateId]: updatedCandidate },
    }

    state = createOfficeAssignment(state, { kind: 'house', id: newHouseId }, 'leader', candidateId)
    currentCtx = { ...currentCtx, state }

    if (currentCtx.config.founderFamilyGenerationEnabled) {
      currentCtx = generateFounderFamily(currentCtx, candidateId, newHouseId)
    }

    currentCtx = {
      ...currentCtx,
      state: initializeHouseShares(currentCtx.state, currentCtx.config, newHouseId),
    }

    const house = currentCtx.state.houses[newHouseId]
    const founder = currentCtx.state.persons[candidateId]
    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: 'HOUSE_FOUNDED',
      importance: 'major',
      messageKey: 'house.founded',
      messageParams: {
        person: nameParam('person', founder?.nameKey ?? ''),
        house: nameParam('house', house?.nameKey ?? houseNameKey),
      },
      entityRefs: [
        entityRef('person', candidateId, 'founder', founder?.nameKey),
        entityRef('house', newHouseId, 'house', house?.nameKey ?? houseNameKey),
      ],
    })
    currentCtx = { ...eventCtx, state: currentCtx.state, events: [...eventCtx.events, event] }

    log.log('HOUSE_FOUNDED', {
      year: currentCtx.state.currentYear,
      weekOfYear: currentCtx.state.currentWeekOfYear,
      founder: candidateId,
      house: newHouseId,
    })

    foundedCount++
  }

  return currentCtx
}

function isFoundingCandidate(
  state: WorldState,
  config: TickContext['config'],
  person: NonNullable<WorldState['persons'][PersonId]>,
): boolean {
  if (person.wealth >= config.houseFoundingMinWealth) return true
  if (person.legacyPrestige >= config.houseFoundingMinPrestige) return true

  const officeIds = state.officeIndex.byHolderPerson[person.id as string] ?? []
  for (const oaId of officeIds) {
    const oa = state.officeAssignments[oaId]
    if (oa?.active) return true
  }
  const holdingOfficeIds = state.holdingOfficeIndex.byHolderPerson[person.id] ?? []
  for (const hoaId of holdingOfficeIds) {
    const hoa = state.holdingOfficeAssignments[hoaId]
    if (hoa?.active) return true
  }

  const logIds = state.personActivityLogIndex.byPerson[person.id as string] ?? []
  if (logIds.length >= config.houseFoundingMinActivityLogs) return true

  return false
}

function determineSeatProvinceId(
  state: WorldState,
  rng: RngState,
  personId: PersonId,
): { provinceId: ProvinceId | undefined; rng: RngState } {
  const holdingOfficeIds = state.holdingOfficeIndex.byHolderPerson[personId] ?? []
  for (const hoaId of holdingOfficeIds) {
    const hoa = state.holdingOfficeAssignments[hoaId]
    if (!hoa?.active) continue
    const holding = state.holdings[hoa.holdingId]
    if (holding) return { provinceId: holding.provinceId, rng }
  }

  const officeIds = state.officeIndex.byHolderPerson[personId as string] ?? []
  for (const oaId of officeIds) {
    const oa = state.officeAssignments[oaId]
    if (!oa?.active) continue
    if (oa.organization.kind === 'polity') {
      const polity = state.polities[oa.organization.id]
      if (polity?.capitalProvinceId) return { provinceId: polity.capitalProvinceId, rng }
    }
  }

  const provinceIds = Object.keys(state.provinces).sort() as ProvinceId[]
  if (provinceIds.length === 0) return { provinceId: undefined, rng }
  const { value: idx, rng: rngAfter } = randomInt(rng, 0, provinceIds.length - 1)
  return { provinceId: provinceIds[idx], rng: rngAfter }
}

function generateFounderFamily(
  ctx: TickContext,
  founderId: PersonId,
  houseId: HouseId,
): TickContext {
  let currentCtx = ctx
  const founder = currentCtx.state.persons[founderId]
  if (!founder) return currentCtx

  const founderAge = founder.age
  const config = currentCtx.config

  let spouseChance: number
  let maxChildren: number
  if (founderAge < 30) {
    spouseChance = config.founderSpouseChanceYoung
    maxChildren = 1
  } else if (founderAge < 50) {
    spouseChance = config.founderSpouseChanceMid
    maxChildren = 3
  } else {
    spouseChance = config.founderSpouseChanceOld
    maxChildren = config.founderMaxGeneratedChildren
  }

  let spouseId: PersonId | undefined

  const { value: spouseRoll, rng: rngAfterSpouseRoll } = randomFloat(currentCtx.rng)
  currentCtx = { ...currentCtx, rng: rngAfterSpouseRoll }

  if (spouseRoll < spouseChance) {
    const spouseSex = founder.sex === 'male' ? 'female' : 'male'
    const minSpouseAge = Math.max(config.adultAge, founderAge - 5)
    const maxSpouseAge = Math.min(60, founderAge + 2)
    if (minSpouseAge <= maxSpouseAge) {
      const { value: spouseAge, rng: rngAge } = randomInt(
        currentCtx.rng,
        minSpouseAge,
        maxSpouseAge,
      )
      currentCtx = { ...currentCtx, rng: rngAge }

      let spouseNameKey: string
      if (currentCtx.namePoolService) {
        const { value: key, rng: rngN } = currentCtx.namePoolService.pickNameKey(currentCtx.rng, {
          nameCultureId: currentCtx.config.nameCultureId,
          category: 'person',
          path: [spouseSex === 'male' ? 'male' : 'female'],
        })
        currentCtx = { ...currentCtx, rng: rngN }
        spouseNameKey = key
      } else {
        const { name, rng: rngN } = pickNameBySex(spouseSex, currentCtx.rng)
        currentCtx = { ...currentCtx, rng: rngN }
        spouseNameKey = name
      }

      const { id: sId, ctx: ctxWithSpouseId } = makePersonId(currentCtx)
      currentCtx = ctxWithSpouseId
      spouseId = sId

      const { value: spousePerson, rng: rngAfterSample } = samplePerson(
        currentCtx.rng,
        currentCtx.config,
        {
          id: spouseId,
          nameKey: spouseNameKey,
          sex: spouseSex,
          age: spouseAge,
          houseId,
          birthStatus: 'unknown',
          traits: { ambition: 0.5, caution: 0.5 },
        },
      )
      currentCtx = { ...currentCtx, rng: rngAfterSample }

      const house = currentCtx.state.houses[houseId]
      if (house) {
        const updatedFounder = {
          ...currentCtx.state.persons[founderId]!,
          spouseId,
        }
        const updatedSpouse = { ...spousePerson, spouseId: founderId }

        currentCtx = {
          ...currentCtx,
          state: {
            ...currentCtx.state,
            persons: {
              ...currentCtx.state.persons,
              [founderId]: updatedFounder,
              [spouseId]: updatedSpouse,
            },
            houses: {
              ...currentCtx.state.houses,
              [houseId]: { ...house, memberIds: [...house.memberIds, spouseId] },
            },
          },
        }
      }
    }
  }

  const founderCurrent = currentCtx.state.persons[founderId]
  if (!founderCurrent) return currentCtx

  const minChildAge = 0
  const maxChildAge = founderAge - 16
  if (maxChildAge < minChildAge) return currentCtx

  const fatherId = founder.sex === 'male' ? founderId : spouseId
  const motherId = founder.sex === 'female' ? founderId : spouseId

  for (let i = 0; i < maxChildren; i++) {
    const { value: childRoll, rng: rngCR } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rngCR }
    if (childRoll >= config.founderChildBaseChance) continue

    const { value: childAge, rng: rngCA } = randomInt(currentCtx.rng, minChildAge, maxChildAge)
    currentCtx = { ...currentCtx, rng: rngCA }

    const { value: sexRoll, rng: rngSR } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: rngSR }
    const childSex = sexRoll < 0.5 ? 'male' : 'female'

    let childNameKey: string
    if (currentCtx.namePoolService) {
      const { value: key, rng: rngN } = currentCtx.namePoolService.pickNameKey(currentCtx.rng, {
        nameCultureId: currentCtx.config.nameCultureId,
        category: 'person',
        path: [childSex === 'male' ? 'male' : 'female'],
      })
      currentCtx = { ...currentCtx, rng: rngN }
      childNameKey = key
    } else {
      const { name, rng: rngN } = pickNameBySex(childSex, currentCtx.rng)
      currentCtx = { ...currentCtx, rng: rngN }
      childNameKey = name
    }

    const { id: childId, ctx: ctxWithChildId } = makePersonId(currentCtx)
    currentCtx = ctxWithChildId

    const { value: childPerson, rng: rngAfterChild } = samplePerson(
      currentCtx.rng,
      currentCtx.config,
      {
        id: childId,
        nameKey: childNameKey,
        sex: childSex,
        age: childAge,
        houseId,
        birthStatus: 'legitimate',
        traits: { ambition: 0.5, caution: 0.5 },
        ...(fatherId !== undefined ? { fatherId } : {}),
        ...(motherId !== undefined ? { motherId } : {}),
      },
    )
    currentCtx = { ...currentCtx, rng: rngAfterChild }

    const house = currentCtx.state.houses[houseId]
    if (!house) continue

    const newPersons: WorldState['persons'] = {
      ...currentCtx.state.persons,
      [childId]: childPerson,
    }

    if (fatherId !== undefined) {
      const father = newPersons[fatherId]
      if (father) {
        newPersons[fatherId] = { ...father, childIds: [...father.childIds, childId] }
      }
    }
    if (motherId !== undefined) {
      const mother = newPersons[motherId]
      if (mother) {
        newPersons[motherId] = { ...mother, childIds: [...mother.childIds, childId] }
      }
    }

    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        persons: newPersons,
        houses: {
          ...currentCtx.state.houses,
          [houseId]: { ...house, memberIds: [...house.memberIds, childId] },
        },
      },
    }
  }

  return currentCtx
}
