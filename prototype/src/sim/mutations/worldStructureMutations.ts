import type { TickContext } from '../tick/context'
import { makeHouseId, makePersonId, makeCountryId, makeEventId } from '../tick/context'
import { randomFloat, randomInt } from '../rng/rng'
import type { HouseId, PersonId, ProvinceId, CountryId } from '../types/ids'
import type { House } from '../types/house'
import type { Person } from '../types/person'
import type { Country } from '../types/country'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import type { PopClass } from '../types/popGroup'
import type { CtxResult } from './result'
import { ok, err } from './result'
import { createOfficeAssignment, revokeOfficesByOrganization } from './officeMutations'
import { movePersonToHouse } from './personMutations'
import { transferProvinceToHouse } from './provinceMutations'
import { getHouseLeader, getCountryRulerHouse } from '../selectors/officeSelectors'
import { getDominantCountryHouse } from '../selectors/shareSelectors'
import { adjustCountryLegacyPrestige } from '../helpers/attitudeHelpers'
import {
  pickNameBySex,
  pickUniqueName,
  houseNamePool,
  houseName as houseNameFn,
} from '../worldgen/nameGenerators'
import { generateCountryName } from '../selectors/countryNamingService'
import { createLogger } from '../debug/logger'
import { samplePerson } from '../helpers/personFactory'

// ============================================================================
// Split House Orchestration
// Extracted from houseSplitSystem.ts (execution phase)
// ============================================================================

export function splitHouse(
  ctx: TickContext,
  input: { houseId: HouseId; splitterPersonId: PersonId },
): CtxResult<{ newHouseId: HouseId }> {
  const house = ctx.state.houses[input.houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: `splitHouse: house not found: ${input.houseId}`,
    })

  const splitterPerson = ctx.state.persons[input.splitterPersonId]
  if (!splitterPerson)
    return err({
      code: 'PERSON_NOT_FOUND',
      message: `splitHouse: splitter not found: ${input.splitterPersonId}`,
    })

  // Province fraction selection
  const controlMin = ctx.config.houseSplitControlMin / 100
  const controlMax = ctx.config.houseSplitControlMax / 100
  const { value: controlFraction, rng: rngAfterControl } = randomFloat(ctx.rng)
  const F = controlMin + controlFraction * (controlMax - controlMin)
  const sortedProvinceIds = [...house.provinceIds].sort()
  const splitCount = Math.max(1, Math.floor(sortedProvinceIds.length * F))
  const splitProvinces = sortedProvinceIds.slice(sortedProvinceIds.length - splitCount)

  // Allocate new house ID using original ctx (makeHouseId doesn't advance rng)
  const { id: newHouseId, ctx: ctxWithId } = makeHouseId(ctx)

  const parentLeaderId = getHouseLeader(ctxWithId.state, input.houseId)
  const newMemberIds: PersonId[] = [splitterPerson.id]

  if (splitterPerson.spouseId !== undefined) {
    const spouse = ctxWithId.state.persons[splitterPerson.spouseId]
    if (
      spouse &&
      spouse.alive &&
      spouse.houseId === input.houseId &&
      (parentLeaderId === undefined || (splitterPerson.spouseId as string) !== parentLeaderId)
    ) {
      newMemberIds.push(spouse.id)
    }
  }

  for (const childId of splitterPerson.childIds) {
    const child = ctxWithId.state.persons[childId]
    if (
      child &&
      child.alive &&
      child.houseId === input.houseId &&
      (childId as string) !== parentLeaderId
    ) {
      newMemberIds.push(childId)
    }
  }

  const newHouseWealth = Math.floor(house.wealth * ctx.config.houseSplitWealthShare)
  const firstSplitProvince = splitProvinces[0] ?? house.seatProvinceId

  const newHouseObj: House = {
    id: newHouseId,
    name: splitterPerson.name + "'s House",
    active: true,
    countryId: house.countryId,
    provinceIds: splitProvinces,
    memberIds: [splitterPerson.id],
    founderId: splitterPerson.id,
    cadetHouseIds: [],
    legacyPrestige: Math.floor(house.legacyPrestige * 0.5),
    wealth: newHouseWealth,
    seatProvinceId: firstSplitProvince,
    parentHouseId: house.id,
  }

  let stateWithNewHouse: WorldState = {
    ...ctxWithId.state,
    houses: { ...ctxWithId.state.houses, [newHouseId]: newHouseObj },
  }
  stateWithNewHouse = createOfficeAssignment(
    stateWithNewHouse,
    { kind: 'house', id: newHouseId },
    'leader',
    splitterPerson.id,
  )
  let resultCtx = { ...ctxWithId, rng: rngAfterControl, state: stateWithNewHouse }

  const familyPersonIds = new Set(newMemberIds)

  const parentHouse = resultCtx.state.houses[input.houseId]
  if (!parentHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: `splitHouse: parent house ${input.houseId} not found after update`,
    })

  const splitProvincesSet = new Set<ProvinceId>(splitProvinces)
  const newParentProvinceIds = parentHouse.provinceIds.filter((pid) => !splitProvincesSet.has(pid))
  const newParentSeatProvinceId: ProvinceId = splitProvincesSet.has(parentHouse.seatProvinceId)
    ? (newParentProvinceIds[0] ?? ('' as ProvinceId))
    : parentHouse.seatProvinceId
  const newParentMemberIds = parentHouse.memberIds.filter((pid) => !familyPersonIds.has(pid))
  const newParentWealth = parentHouse.wealth - newHouseWealth

  const newParentHouseObj = {
    ...parentHouse,
    provinceIds: newParentProvinceIds,
    seatProvinceId: newParentSeatProvinceId,
    memberIds: newParentMemberIds,
    wealth: newParentWealth,
    cadetHouseIds: [...parentHouse.cadetHouseIds, newHouseId],
    legacyPrestige: Math.floor(parentHouse.legacyPrestige * 0.5),
  }

  const stateWithParentUpdate: WorldState = {
    ...resultCtx.state,
    houses: { ...resultCtx.state.houses, [input.houseId]: newParentHouseObj },
  }
  resultCtx = { ...resultCtx, state: stateWithParentUpdate }

  const newHouseCountryId = resultCtx.state.houses[newHouseId]?.countryId
  const updatedProvs = { ...resultCtx.state.provinces }
  for (const pid of splitProvinces) {
    const prov = updatedProvs[pid]
    if (!prov) continue
    updatedProvs[pid] = {
      ...prov,
      ownerHouseId: newHouseId,
      countryId: newHouseCountryId ?? prov.countryId,
    }
  }
  resultCtx = { ...resultCtx, state: { ...resultCtx.state, provinces: updatedProvs } }

  const splitterPersonCurrent = resultCtx.state.persons[splitterPerson.id]
  if (splitterPersonCurrent) {
    const newPersons = { ...resultCtx.state.persons }
    newPersons[splitterPerson.id] = {
      ...splitterPersonCurrent,
      houseId: newHouseId,
      countryId: resultCtx.state.houses[newHouseId]?.countryId ?? splitterPersonCurrent.countryId,
    }
    resultCtx = { ...resultCtx, state: { ...resultCtx.state, persons: newPersons } }
  }

  for (const personId of newMemberIds) {
    if (personId === splitterPerson.id) continue
    const moveResult = movePersonToHouse(resultCtx.state, personId, newHouseId)
    if (moveResult.ok) resultCtx = { ...resultCtx, state: moveResult.value }
  }

  const country = resultCtx.state.countries[house.countryId]
  if (country) {
    const newCountries = { ...resultCtx.state.countries }
    newCountries[house.countryId] = {
      ...country,
      houseIds: [...country.houseIds, newHouseId],
    }
    resultCtx = { ...resultCtx, state: { ...resultCtx.state, countries: newCountries } }
  }

  const { id: eventId, ctx: eventCtx } = makeEventId(resultCtx)
  const splitEvent: SimEvent = {
    id: eventId,
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    type: 'HOUSE_SPLIT',
    importance: 'major',
    actorIds: [splitterPerson.id],
    houseIds: [input.houseId, newHouseId],
    countryIds: [house.countryId],
    provinceIds: splitProvinces,
    summary: `${splitterPerson.name} has split from ${house.name} to form a new house.`,
    reasons: [],
    effects: [],
  }
  resultCtx = { ...eventCtx, state: resultCtx.state, events: [...eventCtx.events, splitEvent] }

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_SPLIT', {
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    house: input.houseId,
    result: 'split',
    new_house: newHouseId,
  })

  const { id: crisisId, ctx: crisisCtx } = makeEventId(resultCtx)
  const crisisEvent: SimEvent = {
    id: crisisId,
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    type: 'SUCCESSION_CRISIS',
    importance: 'major',
    actorIds: [splitterPerson.id],
    houseIds: [input.houseId],
    countryIds: [house.countryId],
    provinceIds: [],
    summary: `A succession crisis has erupted due to the house split!`,
    reasons: [],
    effects: [],
  }
  resultCtx = { ...crisisCtx, state: resultCtx.state, events: [...crisisCtx.events, crisisEvent] }

  return ok({ ctx: resultCtx, value: { newHouseId } })
}

// ============================================================================
// House Extinction Orchestration
// Extracted from houseExtinctionSystem.ts
// ============================================================================

function moveLivingMembersToHouse(
  state: WorldState,
  fromHouseId: HouseId,
  toHouseId: HouseId,
): WorldState {
  if (fromHouseId === toHouseId) return state

  const fromHouse = state.houses[fromHouseId]
  if (!fromHouse) return state

  const toHouse = state.houses[toHouseId]
  if (!toHouse) return state

  const livingMemberIds = fromHouse.memberIds.filter((id) => {
    const p = state.persons[id]
    return p && p.alive
  })

  if (livingMemberIds.length === 0) return state

  const newPersons = { ...state.persons }
  for (const pid of livingMemberIds) {
    const person = newPersons[pid]
    if (!person) continue
    newPersons[pid] = { ...person, houseId: toHouseId, countryId: toHouse.countryId }
  }

  const newHouses = { ...state.houses }
  newHouses[toHouseId] = {
    ...toHouse,
    memberIds: [...toHouse.memberIds, ...livingMemberIds],
  }

  return { ...state, persons: newPersons, houses: newHouses }
}

function transferOrphanProvincesToBestNeighbor(
  state: WorldState,
  orphanProvinceIds: ProvinceId[],
  excludeCountryId: CountryId,
): WorldState {
  if (orphanProvinceIds.length === 0) return state

  const neighborCount = new Map<CountryId, number>()
  for (const pid of orphanProvinceIds) {
    const p = state.provinces[pid]
    if (!p) continue
    for (const neighborId of p.neighbors) {
      const neighbor = state.provinces[neighborId]
      if (!neighbor) continue
      const cid = neighbor.countryId
      if (cid === excludeCountryId) continue
      const c = state.countries[cid]
      if (!c || !c.active) continue
      neighborCount.set(cid, (neighborCount.get(cid) ?? 0) + 1)
    }
  }

  let bestAnnexerId: CountryId | null = null
  let bestScore = -1
  for (const [cid, score] of neighborCount.entries()) {
    if (score > bestScore) {
      bestScore = score
      bestAnnexerId = cid
    }
  }

  if (!bestAnnexerId) {
    let maxProvinces = -1
    for (const [id, country] of Object.entries(state.countries)) {
      if (!country || !country.active || id === excludeCountryId) continue
      const count = Object.values(state.provinces).filter((p) => p?.countryId === id).length
      if (count > maxProvinces) {
        maxProvinces = count
        bestAnnexerId = id as CountryId
      }
    }
  }

  if (!bestAnnexerId) return state

  const receiverHouseId =
    getCountryRulerHouse(state, bestAnnexerId) ?? getDominantCountryHouse(state, bestAnnexerId)
  if (!receiverHouseId) return state

  let result = state
  for (const pid of orphanProvinceIds) {
    const r = transferProvinceToHouse(result, pid, receiverHouseId)
    if (r.ok) result = r.value
  }
  return result
}

function handleNormalHouseExtinction(ctx: TickContext, houseId: HouseId): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  const country = ctx.state.countries[house.countryId]
  if (!country) return ctx

  const rulerHouseId = getCountryRulerHouse(ctx.state, house.countryId)
  const rulerHouse = rulerHouseId ? ctx.state.houses[rulerHouseId] : undefined
  const receiverHouseId = rulerHouse?.active
    ? rulerHouseId
    : (Object.values(ctx.state.houses)
        .filter(
          (h): h is House =>
            h !== null && h.active && h.countryId === house.countryId && h.id !== houseId,
        )
        .sort((a, b) => b.legacyPrestige - a.legacyPrestige)[0]?.id ?? null)

  if (!receiverHouseId) {
    let finalState = ctx.state
    finalState = transferOrphanProvincesToBestNeighbor(
      finalState,
      house.provinceIds,
      house.countryId,
    )
    const newHouses = { ...finalState.houses }
    const extinctHouseObj = newHouses[houseId]
    if (!extinctHouseObj) return ctx
    newHouses[houseId] = { ...extinctHouseObj, active: false, memberIds: [], provinceIds: [] }
    const newCountries = { ...finalState.countries }
    const extinctCountry = newCountries[house.countryId]
    if (extinctCountry) {
      newCountries[house.countryId] = { ...extinctCountry, active: false }
    }
    const finalStateWithExtinction = { ...finalState, houses: newHouses, countries: newCountries }
    const { id: eventId, ctx: eventCtx } = makeEventId({ ...ctx, state: finalStateWithExtinction })
    const event: SimEvent = {
      id: eventId,
      year: finalStateWithExtinction.currentYear,
      month: finalStateWithExtinction.currentMonth,
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      actorIds: [],
      houseIds: [houseId],
      countryIds: [house.countryId],
      provinceIds: [],
      summary: `${house.name} has become extinct.`,
      reasons: [],
      effects: [],
    }
    return { ...eventCtx, state: finalStateWithExtinction, events: [...eventCtx.events, event] }
  }

  let resultCtx = ctx
  const sortedProvinceIds = [...house.provinceIds].sort()

  let chainState = resultCtx.state
  for (const pid of sortedProvinceIds) {
    const r = transferProvinceToHouse(chainState, pid, receiverHouseId)
    if (r.ok) chainState = r.value
  }

  const inheritedControl = resultCtx.config.inheritedProvinceHouseControl

  let controlChainState = chainState
  for (const pid of sortedProvinceIds) {
    const province = controlChainState.provinces[pid]
    if (!province) continue
    const newProvinces = { ...controlChainState.provinces }
    newProvinces[pid] = { ...province, houseControl: inheritedControl }
    controlChainState = { ...controlChainState, provinces: newProvinces }
  }

  resultCtx = { ...resultCtx, state: controlChainState }

  const stateAfterMove = moveLivingMembersToHouse(resultCtx.state, houseId, receiverHouseId)
  resultCtx = { ...resultCtx, state: stateAfterMove }

  const newHouses = { ...resultCtx.state.houses }
  const extinctHouseObj = newHouses[houseId]
  if (!extinctHouseObj) return resultCtx
  newHouses[houseId] = {
    ...extinctHouseObj,
    active: false,
    memberIds: [],
    provinceIds: [],
  }

  const newCountries = { ...resultCtx.state.countries }
  const targetCountry = newCountries[house.countryId]
  if (targetCountry) {
    newCountries[house.countryId] = {
      ...targetCountry,
      houseIds: targetCountry.houseIds.filter((id: HouseId) => id !== houseId),
    }
  }

  const finalState = { ...resultCtx.state, houses: newHouses, countries: newCountries }

  const { id: eventId, ctx: eventCtx } = makeEventId({ ...resultCtx, state: finalState })
  const event: SimEvent = {
    id: eventId,
    year: finalState.currentYear,
    month: finalState.currentMonth,
    type: 'HOUSE_EXTINCT',
    importance: 'major',
    actorIds: [],
    houseIds: [houseId],
    countryIds: [house.countryId],
    provinceIds: [...house.provinceIds],
    summary: `${house.name} has become extinct.`,
    reasons: [],
    effects: [],
  }

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_EXTINCT', {
    year: finalState.currentYear,
    month: finalState.currentMonth,
    house: houseId,
    type: 'normal',
    receiver: receiverHouseId,
  })

  return { ...eventCtx, state: finalState, events: [...eventCtx.events, event] }
}

function handleRulerHouseExtinction(ctx: TickContext, houseId: HouseId): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  const country = ctx.state.countries[house.countryId]
  if (!country) return ctx

  let resultCtx = ctx

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_EXTINCT', {
    year: resultCtx.state.currentYear,
    month: resultCtx.state.currentMonth,
    house: houseId,
    type: 'ruler',
    country: house.countryId,
  })

  const currentCountry = resultCtx.state.countries[house.countryId]
  if (!currentCountry) return resultCtx

  {
    const penaltyState = adjustCountryLegacyPrestige(
      resultCtx.state,
      house.countryId,
      -resultCtx.config.rulerHouseExtinctionPrestigeLoss,
    )
    resultCtx = { ...resultCtx, state: penaltyState }
  }

  const candidateHouses = Object.values(resultCtx.state.houses)
    .filter(
      (h): h is House =>
        h !== null && h.active && h.countryId === house.countryId && h.id !== houseId,
    )
    .sort((a, b) => b.legacyPrestige - a.legacyPrestige)

  const newRulerHouse = candidateHouses[0]
  if (newRulerHouse) {
    let domesticState = resultCtx.state

    const newRulerHouseId = newRulerHouse.id
    const newDomesticCountries = { ...domesticState.countries }
    const updatedCountry = newDomesticCountries[house.countryId]
    if (updatedCountry) {
      newDomesticCountries[house.countryId] = {
        ...updatedCountry,
      }
    }
    domesticState = { ...domesticState, countries: newDomesticCountries }

    const newLeaderId = getHouseLeader(domesticState, newRulerHouseId)
    if (newLeaderId) {
      domesticState = revokeOfficesByOrganization(
        domesticState,
        { kind: 'country', id: house.countryId },
        'leader',
      )
      domesticState = createOfficeAssignment(
        domesticState,
        { kind: 'country', id: house.countryId },
        'leader',
        newLeaderId,
      )
    }

    const sortedProvinceIds = [...house.provinceIds].sort()
    let transferChainState = domesticState
    for (const pid of sortedProvinceIds) {
      const r = transferProvinceToHouse(transferChainState, pid, newRulerHouseId)
      if (r.ok) transferChainState = r.value
    }

    const inheritedControl = resultCtx.config.inheritedProvinceHouseControl
    let controlChainState = transferChainState
    for (const pid of sortedProvinceIds) {
      const province = controlChainState.provinces[pid]
      if (!province) continue
      const newProvinces = { ...controlChainState.provinces }
      newProvinces[pid] = { ...province, houseControl: inheritedControl }
      controlChainState = { ...controlChainState, provinces: newProvinces }
    }

    const stateAfterMemberMove = moveLivingMembersToHouse(
      controlChainState,
      houseId,
      newRulerHouseId,
    )

    const newHouses = { ...stateAfterMemberMove.houses }
    const houseToExtinct = newHouses[houseId]
    if (houseToExtinct) {
      newHouses[houseId] = { ...houseToExtinct, active: false, memberIds: [], provinceIds: [] }
    }

    const newCountry = stateAfterMemberMove.countries[house.countryId]
    if (newCountry) {
      const newCountries2 = { ...stateAfterMemberMove.countries }
      newCountries2[house.countryId] = {
        ...newCountry,
        houseIds: newCountry.houseIds.filter((id: HouseId) => id !== houseId),
      }
      const finalState = { ...stateAfterMemberMove, houses: newHouses, countries: newCountries2 }

      const { id: extEventId, ctx: extEventCtx } = makeEventId({ ...resultCtx, state: finalState })
      const extEvent: SimEvent = {
        id: extEventId,
        year: finalState.currentYear,
        month: finalState.currentMonth,
        type: 'HOUSE_EXTINCT',
        importance: 'major',
        actorIds: [],
        houseIds: [houseId],
        countryIds: [house.countryId],
        provinceIds: [],
        summary: `${house.name} has become extinct.`,
        reasons: [],
        effects: [],
      }
      return { ...extEventCtx, state: finalState, events: [...extEventCtx.events, extEvent] }
    }
  }

  const defunctProvinceIds: ProvinceId[] = Object.values(resultCtx.state.provinces)
    .filter((p): p is NonNullable<typeof p> => p !== null && p.countryId === house.countryId)
    .map((p) => p.id)

  const neighborCandidateMap = new Map<CountryId, number>()
  for (const province of defunctProvinceIds) {
    const prov = resultCtx.state.provinces[province]
    if (!prov) continue
    for (const neighborId of prov.neighbors) {
      const neighbor = resultCtx.state.provinces[neighborId]
      if (!neighbor) continue
      const neighborCountryId = neighbor.countryId
      if (neighborCountryId === house.countryId) continue
      const existing = neighborCandidateMap.get(neighborCountryId) ?? 0
      neighborCandidateMap.set(neighborCountryId, existing + 1)
    }
  }

  const defunctCountryId = house.countryId
  const defunctCountry = resultCtx.state.countries[defunctCountryId]
  if (!defunctCountry) {
    let finalState = resultCtx.state
    finalState = transferOrphanProvincesToBestNeighbor(
      finalState,
      defunctProvinceIds,
      defunctCountryId,
    )
    const collapseHouses = { ...finalState.houses }
    const collapseHouse = collapseHouses[houseId]
    if (collapseHouse) {
      collapseHouses[houseId] = { ...collapseHouse, active: false, memberIds: [], provinceIds: [] }
    }
    const collapseCountries = { ...finalState.countries }
    const collapseCountry = collapseCountries[house.countryId]
    if (collapseCountry) {
      collapseCountries[house.countryId] = { ...collapseCountry, active: false }
    }
    return {
      ...resultCtx,
      state: { ...finalState, houses: collapseHouses, countries: collapseCountries },
    }
  }

  const provinceCountByCountry = new Map<CountryId, number>()
  for (const province of Object.values(resultCtx.state.provinces)) {
    if (!province) continue
    const existing = provinceCountByCountry.get(province.countryId) ?? 0
    provinceCountByCountry.set(province.countryId, existing + 1)
  }

  let annexerCountryId: CountryId | null = null
  let annexerScore = -Infinity
  for (const [candidateId, sharedBorderCount] of neighborCandidateMap.entries()) {
    const candidateCountry = resultCtx.state.countries[candidateId]
    if (!candidateCountry || !candidateCountry.active) continue
    const totalProvinces = provinceCountByCountry.get(candidateId) ?? 0
    const score =
      sharedBorderCount * resultCtx.config.rulerExtinctionAnnexSharedBorderWeight +
      totalProvinces * resultCtx.config.rulerExtinctionAnnexPowerWeight +
      candidateCountry.legacyPrestige * resultCtx.config.rulerExtinctionAnnexPrestigeWeight
    if (score > annexerScore) {
      annexerScore = score
      annexerCountryId = candidateId
    }
  }

  if (annexerCountryId) {
    const annexerCountry = resultCtx.state.countries[annexerCountryId]
    if (!annexerCountry) {
      let finalState = resultCtx.state
      finalState = transferOrphanProvincesToBestNeighbor(
        finalState,
        house.provinceIds,
        house.countryId,
      )
      const collapseHouses = { ...finalState.houses }
      const collapseHouse = collapseHouses[houseId]
      if (collapseHouse) {
        collapseHouses[houseId] = {
          ...collapseHouse,
          active: false,
          memberIds: [],
          provinceIds: [],
        }
      }
      const collapseCountries = { ...finalState.countries }
      const collapseCountry = collapseCountries[house.countryId]
      if (collapseCountry) {
        collapseCountries[house.countryId] = { ...collapseCountry, active: false }
      }
      return {
        ...resultCtx,
        state: { ...finalState, houses: collapseHouses, countries: collapseCountries },
      }
    }

    let annexState = resultCtx

    const annexerRulerHouseId =
      getCountryRulerHouse(annexState.state, annexerCountryId) ??
      getDominantCountryHouse(annexState.state, annexerCountryId)
    if (!annexerRulerHouseId) {
      let finalState = resultCtx.state
      finalState = transferOrphanProvincesToBestNeighbor(
        finalState,
        house.provinceIds,
        house.countryId,
      )
      const collapseHouses = { ...finalState.houses }
      const collapseHouse = collapseHouses[houseId]
      if (collapseHouse) {
        collapseHouses[houseId] = {
          ...collapseHouse,
          active: false,
          memberIds: [],
          provinceIds: [],
        }
      }
      const collapseCountries = { ...finalState.countries }
      const collapseCountry = collapseCountries[house.countryId]
      if (collapseCountry) {
        collapseCountries[house.countryId] = { ...collapseCountry, active: false }
      }
      return {
        ...resultCtx,
        state: { ...finalState, houses: collapseHouses, countries: collapseCountries },
      }
    }

    const extinctHouseProvinceIds = [...house.provinceIds].sort()
    for (const pid of extinctHouseProvinceIds) {
      const r = transferProvinceToHouse(annexState.state, pid, annexerRulerHouseId)
      if (r.ok) annexState = { ...annexState, state: r.value }
    }

    const newProvinces = { ...annexState.state.provinces }
    for (const pid of defunctProvinceIds) {
      const province = newProvinces[pid]
      if (!province) continue
      newProvinces[pid] = {
        ...province,
        countryId: annexerCountryId,
        countryControl: resultCtx.config.annexByRulerExtinctionCountryControl,
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, provinces: newProvinces } }

    annexState = {
      ...annexState,
      state: moveLivingMembersToHouse(annexState.state, houseId, annexerRulerHouseId),
    }

    const newHouses: typeof annexState.state.houses = { ...annexState.state.houses }
    for (const houseObj of Object.values(annexState.state.houses)) {
      if (!houseObj || houseObj.countryId !== defunctCountryId) continue
      if (houseObj.id === houseId) {
        newHouses[houseObj.id] = {
          ...houseObj,
          active: false,
          memberIds: [],
          countryId: annexerCountryId,
        }
      } else {
        newHouses[houseObj.id] = { ...houseObj, countryId: annexerCountryId }
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, houses: newHouses } }

    const newPersons: typeof annexState.state.persons = { ...annexState.state.persons }
    for (const person of Object.values(annexState.state.persons)) {
      if (!person || person.countryId !== defunctCountryId) continue
      if (person.alive) {
        newPersons[person.id] = { ...person, countryId: annexerCountryId }
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, persons: newPersons } }

    const updatedDefunctCountry = annexState.state.countries[defunctCountryId]
    const newCountries1 = { ...annexState.state.countries }
    if (updatedDefunctCountry) {
      newCountries1[defunctCountryId] = { ...updatedDefunctCountry, active: false }
    }
    const updatedAnnexerCountry = annexState.state.countries[annexerCountryId]
    const newCountries2 = { ...newCountries1 }
    if (updatedAnnexerCountry) {
      newCountries2[annexerCountryId] = {
        ...updatedAnnexerCountry,
        houseIds: [
          ...updatedAnnexerCountry.houseIds,
          ...defunctCountry.houseIds.filter((id) => id !== houseId),
        ],
      }
    }
    annexState = { ...annexState, state: { ...annexState.state, countries: newCountries2 } }

    const { id: annexEventId, ctx: annexEventCtx } = makeEventId(annexState)
    const annexEvent: SimEvent = {
      id: annexEventId,
      year: annexState.state.currentYear,
      month: annexState.state.currentMonth,
      type: 'COUNTRY_ANNEXED',
      importance: 'major',
      actorIds: [],
      houseIds: [],
      countryIds: [defunctCountryId, annexerCountryId],
      provinceIds: [],
      summary: `${defunctCountry.name} has been annexed by ${annexerCountry.name}.`,
      reasons: [],
      effects: [],
    }
    return {
      ...annexEventCtx,
      state: annexState.state,
      events: [...annexEventCtx.events, annexEvent],
    }
  }

  const defunctProvinces: ProvinceId[] = Object.values(resultCtx.state.provinces)
    .filter((p): p is NonNullable<typeof p> => p !== null && p.countryId === house.countryId)
    .map((p) => p.id)

  let finalState = resultCtx.state
  finalState = transferOrphanProvincesToBestNeighbor(finalState, defunctProvinces, house.countryId)
  const collapseHouses = { ...finalState.houses }
  const collapseHouse = collapseHouses[houseId]
  if (collapseHouse) {
    collapseHouses[houseId] = { ...collapseHouse, active: false, memberIds: [], provinceIds: [] }
  }
  const collapseCountries = { ...finalState.countries }
  const collapseCountry = collapseCountries[house.countryId]
  if (collapseCountry) {
    collapseCountries[house.countryId] = { ...collapseCountry, active: false }
  }
  return {
    ...resultCtx,
    state: { ...finalState, houses: collapseHouses, countries: collapseCountries },
  }
}

export function extinctHouse(ctx: TickContext, houseId: HouseId): CtxResult<void> {
  const house = ctx.state.houses[houseId]
  if (!house) return ok({ ctx, value: undefined })

  const country = ctx.state.countries[house.countryId]
  if (!country) return ok({ ctx, value: undefined })

  const rulerHouseId = getCountryRulerHouse(ctx.state, house.countryId)
  const updatedCtx =
    house.id === rulerHouseId
      ? handleRulerHouseExtinction(ctx, houseId)
      : handleNormalHouseExtinction(ctx, houseId)

  return ok({ ctx: updatedCtx, value: undefined })
}

// ============================================================================
// Found Revolt Country Orchestration
// Extracted from provinceRevoltSystem.ts resolveRevoltIndependence
// ============================================================================

export function foundRevoltCountry(
  ctx: TickContext,
  input: { provinceId: ProvinceId; rebelClass: PopClass; oldCountryId: CountryId },
): CtxResult<{ countryId: CountryId; houseId: HouseId; personId: PersonId }> {
  const { provinceId, rebelClass, oldCountryId } = input
  const config = ctx.config
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province)
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `foundRevoltCountry: province not found: ${provinceId}`,
    })

  const oldCountry = state.countries[oldCountryId]
  if (!oldCountry)
    return err({
      code: 'COUNTRY_NOT_FOUND',
      message: `foundRevoltCountry: old country not found: ${oldCountryId}`,
    })

  const oldOwnerHouseId = province.ownerHouseId
  const oldOwnerHouse = state.houses[oldOwnerHouseId]

  // Pre-generate IDs
  const { id: newCountryId, ctx: ctx1 } = makeCountryId(ctx)
  const { id: newPersonId, ctx: ctx2 } = makePersonId(ctx1)
  const { id: newHouseId, ctx: ctx3 } = makeHouseId(ctx2)
  ctx = ctx3

  // Generate country name
  const { name: newCountryName, rng: rng0 } = generateCountryName(ctx.state, ctx.config, ctx.rng, {
    origin: 'province_revolt_independence',
    provinceIds: [provinceId],
    capitalProvinceId: provinceId,
    rulingHouseId: newHouseId,
    founderPersonId: newPersonId,
    sourceCountryId: oldCountryId,
    rebelClass,
  })
  ctx = { ...ctx, rng: rng0 }

  // Generate leader name
  const { name: leaderName, rng: rng1 } = pickNameBySex('male', ctx.rng)
  ctx = { ...ctx, rng: rng1 }

  const { value: age, rng: rng2 } = randomInt(ctx.rng, 20, 45)
  ctx = { ...ctx, rng: rng2 }
  const { value: ambition, rng: rng3 } = randomInt(ctx.rng, 7, 10)
  ctx = { ...ctx, rng: rng3 }
  const { value: caution, rng: rng4 } = randomInt(ctx.rng, 2, 7)
  ctx = { ...ctx, rng: rng4 }
  const { value: legacyPrestige, rng: rng5 } = randomInt(ctx.rng, 5, 20)
  ctx = { ...ctx, rng: rng5 }

  const { value: newLeader, rng: rngAfterLeader } = samplePerson(ctx.rng, ctx.config, {
    id: newPersonId,
    name: leaderName,
    sex: 'male',
    age,
    houseId: newHouseId,
    countryId: newCountryId,
    birthStatus: 'unknown',
    traits: { ambition: ambition / 10, caution: caution / 10 },
    legacyPrestige,
  })
  ctx = { ...ctx, rng: rngAfterLeader }

  // Generate house name
  const usedHouseNames = new Set(
    Object.values(ctx.state.houses)
      .filter((h): h is NonNullable<typeof h> => h !== undefined && h.active)
      .map((h) => h.name),
  )
  const { name: newHouseName, rng: rng9 } = pickUniqueName(
    houseNamePool(),
    usedHouseNames,
    houseNameFn,
    ctx.nextHouseIndex,
    ctx.rng,
  )
  ctx = { ...ctx, rng: rng9 }

  const newHouseObj: House = {
    id: newHouseId,
    name: newHouseName,
    active: true,
    countryId: newCountryId,
    provinceIds: [provinceId],
    memberIds: [newPersonId],
    founderId: newPersonId,
    cadetHouseIds: [],
    legacyPrestige: config.revoltHouseInitialLegacyPrestige,
    wealth: config.revoltHouseInitialWealth,
    seatProvinceId: provinceId,
  }

  const newCountryObj: Country = {
    id: newCountryId,
    name: newCountryName,
    houseIds: [newHouseId],
    treasury: config.revoltCountryInitialTreasury,
    legacyPrestige: config.revoltCountryInitialLegacyPrestige,
    adminPower: 0,
    active: true,
    capitalProvinceId: provinceId,
  }

  // Update province ownership manually (state ordering: all new entities created simultaneously)
  const updatedProvince: typeof province = {
    ...province,
    ownerHouseId: newHouseId,
    countryId: newCountryId,
    countryControl: config.provinceRevoltNewCountryControl,
    houseControl: config.provinceRevoltNewHouseControl,
  }

  // Remove province from old owner house
  const updatedOldOwnerHouse = oldOwnerHouse
    ? {
        ...oldOwnerHouse,
        provinceIds: oldOwnerHouse.provinceIds.filter(
          (pid) => (pid as string) !== (provinceId as string),
        ),
        seatProvinceId:
          oldOwnerHouse.seatProvinceId === provinceId
            ? ((oldOwnerHouse.provinceIds.filter(
                (pid) => (pid as string) !== (provinceId as string),
              )[0] ?? '') as ProvinceId)
            : oldOwnerHouse.seatProvinceId,
      }
    : undefined

  // Remove old owner house from old country houseIds if it becomes landless
  const oldOwnerIsRuler = getCountryRulerHouse(state, oldCountryId) === oldOwnerHouseId
  const remainingHouseIds = oldCountry.houseIds.filter(
    (hid) => (hid as string) !== (oldOwnerHouseId as string),
  )

  // Fix capitalProvinceId if the revolting province was the old country's capital
  const newOldCapProvinceId: ProvinceId =
    oldCountry.capitalProvinceId === provinceId
      ? ((Object.values(state.provinces).find(
          (p) => p !== undefined && p.countryId === oldCountryId && p.id !== provinceId,
        )?.id ?? '') as ProvinceId)
      : oldCountry.capitalProvinceId

  const updatedOldCountry =
    updatedOldOwnerHouse && updatedOldOwnerHouse.provinceIds.length === 0
      ? {
          ...oldCountry,
          houseIds: remainingHouseIds,
          active: !oldOwnerIsRuler || remainingHouseIds.length > 0,
          capitalProvinceId: newOldCapProvinceId,
        }
      : {
          ...oldCountry,
          capitalProvinceId: newOldCapProvinceId,
        }

  // Apply all state changes
  let newState: WorldState = {
    ...ctx.state,
    provinces: { ...ctx.state.provinces, [provinceId]: updatedProvince },
    persons: { ...ctx.state.persons, [newPersonId]: newLeader },
    houses: {
      ...ctx.state.houses,
      [newHouseId]: newHouseObj,
      ...(updatedOldOwnerHouse ? { [oldOwnerHouseId]: updatedOldOwnerHouse } : {}),
    },
    countries: {
      ...ctx.state.countries,
      [newCountryId]: newCountryObj,
      [oldCountryId]: updatedOldCountry,
    },
  }

  // Assign leader offices for the new house and country
  newState = createOfficeAssignment(
    newState,
    { kind: 'house' as const, id: newHouseId },
    'leader',
    newPersonId,
  )
  newState = createOfficeAssignment(
    newState,
    { kind: 'country' as const, id: newCountryId },
    'leader',
    newPersonId,
  )

  // If old owner house became landless, deactivate and move members
  if (updatedOldOwnerHouse && updatedOldOwnerHouse.provinceIds.length === 0 && oldOwnerHouse) {
    const deactivatedOldHouse = { ...updatedOldOwnerHouse, active: false }
    const rulerHouseId = getCountryRulerHouse(newState, oldCountryId)
    if (!rulerHouseId) {
      return ok({
        ctx: { ...ctx, state: newState },
        value: { countryId: newCountryId, houseId: newHouseId, personId: newPersonId },
      })
    }
    const rulerHouse = newState.houses[rulerHouseId]
    const updatedPersons: Record<PersonId, Person> = { ...newState.persons }
    const rulerMemberIds = rulerHouse ? [...rulerHouse.memberIds] : []

    for (const memberId of oldOwnerHouse.memberIds) {
      const member = updatedPersons[memberId]
      if (member && member.alive) {
        updatedPersons[memberId] = {
          ...member,
          houseId: rulerHouseId,
          countryId: oldCountryId,
        }
        rulerMemberIds.push(memberId)
      }
    }

    const updatedHouses: Record<HouseId, House> = { ...newState.houses }
    updatedHouses[oldOwnerHouseId] = deactivatedOldHouse
    if (rulerHouse) {
      updatedHouses[rulerHouseId] = { ...rulerHouse, memberIds: rulerMemberIds }
    }

    newState = {
      ...newState,
      persons: updatedPersons,
      houses: updatedHouses,
    }

    // Emit HOUSE_EXTINCT event
    ctx = { ...ctx, state: newState }
    const { id: extinctEventId, ctx: ctxE } = makeEventId(ctx)
    const extinctEvent: SimEvent = {
      id: extinctEventId,
      year: ctxE.state.currentYear,
      month: ctxE.state.currentMonth,
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      actorIds: [],
      houseIds: [oldOwnerHouseId],
      countryIds: [oldCountryId],
      provinceIds: [provinceId],
      summary: `${oldOwnerHouse.name} has fallen from power after losing all lands.`,
      reasons: [],
      effects: [],
    }
    ctx = { ...ctxE, events: [...ctxE.events, extinctEvent] }
  } else {
    ctx = { ...ctx, state: newState }
  }

  // Emit REVOLT_COUNTRY_FOUNDED event
  const { id: eventId, ctx: ctx4 } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: ctx4.state.currentYear,
    month: ctx4.state.currentMonth,
    type: 'REVOLT_COUNTRY_FOUNDED',
    importance: 'critical',
    actorIds: [newPersonId],
    houseIds: [newHouseId],
    countryIds: [newCountryId, oldCountryId],
    provinceIds: [provinceId],
    summary: `${newCountryObj.name} has been founded by ${newLeader.name} through revolt in ${province.name}!`,
    reasons: [],
    effects: [],
  }
  ctx = { ...ctx4, events: [...ctx4.events, event] }

  return ok({ ctx, value: { countryId: newCountryId, houseId: newHouseId, personId: newPersonId } })
}
