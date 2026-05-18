import type { TickContext } from '../tick/context'
import { makeHouseId, makePersonId, makePolityId, makeEventId } from '../tick/context'
import { randomFloat, randomInt } from '../rng/rng'
import type { HouseId, PersonId, ProvinceId, PolityId } from '../types/ids'
import type { House } from '../types/house'
import type { Person } from '../types/person'
import type { Polity } from '../types/polity'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import type { PopClass } from '../types/popGroup'
import type { CtxResult } from './result'
import { ok, err } from './result'
import { createOfficeAssignment } from './officeMutations'
import { movePersonToHouse } from './personMutations'
import { transferProvinceToHouse } from './provinceMutations'
import { getHouseLeader, getPolityLeaderHouse } from '../selectors/officeSelectors'
import { getDominantPolityHouse } from '../selectors/shareSelectors'
import {
  pickNameBySex,
  pickUniqueName,
  houseNamePool,
  houseName as houseNameFn,
} from '../worldgen/nameGenerators'
import { generatePolityName } from '../selectors/polityNamingService'
import { getHousePrimaryPolityId, getPolityHouseIds } from '../selectors/polityRelations'
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

  const newHousePolityId = getHousePrimaryPolityId(ctxWithId.state, house.id)
  const newHouseObj: House = {
    id: newHouseId,
    name: splitterPerson.name + "'s House",
    active: true,
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

  const updatedProvs = { ...resultCtx.state.provinces }
  for (const pid of splitProvinces) {
    const prov = updatedProvs[pid]
    if (!prov) continue
    updatedProvs[pid] = {
      ...prov,
      ownerHouseId: newHouseId,
      polityId: newHousePolityId ?? prov.polityId,
    }
  }
  resultCtx = { ...resultCtx, state: { ...resultCtx.state, provinces: updatedProvs } }

  const splitterPersonCurrent = resultCtx.state.persons[splitterPerson.id]
  if (splitterPersonCurrent) {
    const newPersons = { ...resultCtx.state.persons }
    newPersons[splitterPerson.id] = {
      ...splitterPersonCurrent,
      houseId: newHouseId,
    }
    resultCtx = { ...resultCtx, state: { ...resultCtx.state, persons: newPersons } }
  }

  for (const personId of newMemberIds) {
    if (personId === splitterPerson.id) continue
    const moveResult = movePersonToHouse(resultCtx.state, personId, newHouseId)
    if (moveResult.ok) resultCtx = { ...resultCtx, state: moveResult.value }
  }

  const housePolityId = getHousePrimaryPolityId(resultCtx.state, house.id)
  if (housePolityId) {
    const newPolities = { ...resultCtx.state.polities }
    const polity = resultCtx.state.polities[housePolityId]
    if (polity) {
      newPolities[housePolityId] = {
        ...polity,
      }
    }
    resultCtx = { ...resultCtx, state: { ...resultCtx.state, polities: newPolities } }
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
    polityIds: [housePolityId ?? ('' as PolityId)],
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
    polityIds: [housePolityId ?? ('' as PolityId)],
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
    newPersons[pid] = { ...person, houseId: toHouseId }
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
  excludePolityId: PolityId,
): WorldState {
  if (orphanProvinceIds.length === 0) return state

  const neighborCount = new Map<PolityId, number>()
  for (const pid of orphanProvinceIds) {
    const p = state.provinces[pid]
    if (!p) continue
    for (const neighborId of p.neighbors) {
      const neighbor = state.provinces[neighborId]
      if (!neighbor) continue
      const pid2 = neighbor.polityId
      if (pid2 === excludePolityId) continue
      const polity = state.polities[pid2]
      if (!polity || !polity.active) continue
      neighborCount.set(pid2, (neighborCount.get(pid2) ?? 0) + 1)
    }
  }

  let bestAnnexerId: PolityId | null = null
  let bestScore = -1
  for (const [pid2, score] of neighborCount.entries()) {
    if (score > bestScore) {
      bestScore = score
      bestAnnexerId = pid2
    }
  }

  if (!bestAnnexerId) {
    let maxProvinces = -1
    for (const [id, polity] of Object.entries(state.polities)) {
      if (!polity || !polity.active || id === excludePolityId) continue
      const count = Object.values(state.provinces).filter((p) => p?.polityId === id).length
      if (count > maxProvinces) {
        maxProvinces = count
        bestAnnexerId = id as PolityId
      }
    }
  }

  if (!bestAnnexerId) return state

  const receiverHouseId =
    getPolityLeaderHouse(state, bestAnnexerId) ?? getDominantPolityHouse(state, bestAnnexerId)
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

  const polityId = getHousePrimaryPolityId(ctx.state, house.id)
  if (!polityId) return ctx

  const polity = ctx.state.polities[polityId]
  if (!polity) return ctx

  const rulerHouseId = getPolityLeaderHouse(ctx.state, polityId)
  const rulerHouse = rulerHouseId ? ctx.state.houses[rulerHouseId] : undefined
  const receiverHouseId = rulerHouse?.active
    ? rulerHouseId
    : (Object.values(ctx.state.houses)
        .filter(
          (h): h is House =>
            h !== null &&
            h.active &&
            getHousePrimaryPolityId(ctx.state, h.id) === polityId &&
            h.id !== houseId,
        )
        .sort((a, b) => b.legacyPrestige - a.legacyPrestige)[0]?.id ?? null)

  if (!receiverHouseId) {
    let finalState = ctx.state
    finalState = transferOrphanProvincesToBestNeighbor(finalState, house.provinceIds, polityId)
    const newHouses = { ...finalState.houses }
    const extinctHouseObj = newHouses[houseId]
    if (!extinctHouseObj) return ctx
    newHouses[houseId] = { ...extinctHouseObj, active: false, memberIds: [], provinceIds: [] }
    const newPolities = { ...finalState.polities }
    const extinctPolity = newPolities[polityId]
    if (extinctPolity) {
      newPolities[polityId] = { ...extinctPolity, active: false }
    }
    const finalStateWithExtinction = { ...finalState, houses: newHouses, polities: newPolities }
    const { id: eventId, ctx: eventCtx } = makeEventId({ ...ctx, state: finalStateWithExtinction })
    const event: SimEvent = {
      id: eventId,
      year: finalStateWithExtinction.currentYear,
      month: finalStateWithExtinction.currentMonth,
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      actorIds: [],
      houseIds: [houseId],
      polityIds: [polityId],
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

  const newPolities = { ...resultCtx.state.polities }
  if (polityId) {
    const targetPolity = newPolities[polityId]
    if (targetPolity) {
      newPolities[polityId] = {
        ...targetPolity,
      }
    }
  }

  const finalState = { ...resultCtx.state, houses: newHouses, polities: newPolities }

  const { id: eventId, ctx: eventCtx } = makeEventId({ ...resultCtx, state: finalState })
  const event: SimEvent = {
    id: eventId,
    year: finalState.currentYear,
    month: finalState.currentMonth,
    type: 'HOUSE_EXTINCT',
    importance: 'major',
    actorIds: [],
    houseIds: [houseId],
    polityIds: [polityId ?? ('' as PolityId)],
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

// v0.15 §22.3: extinctHouse は所領を失う直前の Polity (Country) 集合を入力として受け取る。
// Stage A では handleNormalHouseExtinction の v0.14 ロジックを温存し、
// affectedCountryIds は呼び出し側でスナップショットを取得するが内部では既存挙動を維持する。
// Phase 9 で affectedPolityIds に rename され、候補探索のスコープとして使われる。
export type HouseExtinctionInput = {
  houseId: HouseId
  affectedPolityIds: PolityId[]
}

export function extinctHouse(ctx: TickContext, input: HouseExtinctionInput): CtxResult<void> {
  const { houseId } = input
  const house = ctx.state.houses[houseId]
  if (!house) return ok({ ctx, value: undefined })

  const polityId = getHousePrimaryPolityId(ctx.state, house.id)
  if (!polityId) return ok({ ctx, value: undefined })

  const polity = ctx.state.polities[polityId]
  if (!polity) return ok({ ctx, value: undefined })

  const updatedCtx = handleNormalHouseExtinction(ctx, houseId)

  return ok({ ctx: updatedCtx, value: undefined })
}

// ============================================================================
// Found Revolt Country Orchestration
// Extracted from provinceRevoltSystem.ts resolveRevoltIndependence
// ============================================================================

export function foundRevoltCountry(
  ctx: TickContext,
  input: { provinceId: ProvinceId; rebelClass: PopClass; oldPolityId: PolityId },
): CtxResult<{ polityId: PolityId; houseId: HouseId; personId: PersonId }> {
  const { provinceId, rebelClass, oldPolityId } = input
  const config = ctx.config
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province)
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `foundRevoltCountry: province not found: ${provinceId}`,
    })

  const oldPolity = state.polities[oldPolityId]
  if (!oldPolity)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `foundRevoltCountry: old polity not found: ${oldPolityId}`,
    })

  const oldOwnerHouseId = province.ownerHouseId
  const oldOwnerHouse = state.houses[oldOwnerHouseId]

  // Pre-generate IDs
  const { id: newPolityId, ctx: ctx1 } = makePolityId(ctx)
  const { id: newPersonId, ctx: ctx2 } = makePersonId(ctx1)
  const { id: newHouseId, ctx: ctx3 } = makeHouseId(ctx2)
  ctx = ctx3

  // Generate polity name
  const { name: newPolityName, rng: rng0 } = generatePolityName(ctx.state, ctx.config, ctx.rng, {
    origin: 'province_revolt_independence',
    provinceIds: [provinceId],
    capitalProvinceId: provinceId,
    rulingHouseId: newHouseId,
    founderPersonId: newPersonId,
    sourcePolityId: oldPolityId,
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
    provinceIds: [provinceId],
    memberIds: [newPersonId],
    founderId: newPersonId,
    cadetHouseIds: [],
    legacyPrestige: config.revoltHouseInitialLegacyPrestige,
    wealth: config.revoltHouseInitialWealth,
    seatProvinceId: provinceId,
  }

  const newPolityObj: Polity = {
    id: newPolityId,
    name: newPolityName,
    treasury: config.revoltPolityInitialTreasury,
    legacyPrestige: config.revoltPolityInitialLegacyPrestige,
    adminPower: 0,
    active: true,
    capitalProvinceId: provinceId,
    rank: 2,
    ownerHouseId: newHouseId,
  }

  // Update province ownership manually (state ordering: all new entities created simultaneously)
  const updatedProvince: typeof province = {
    ...province,
    ownerHouseId: newHouseId,
    polityId: newPolityId,
    polityControl: config.provinceRevoltNewCountryControl,
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

  // Remove old owner house from old polity houseIds if it becomes landless
  const oldOwnerIsRuler = getPolityLeaderHouse(state, oldPolityId) === oldOwnerHouseId
  const existingHouseIds = getPolityHouseIds(state, oldPolityId)
  const remainingHouseIds = existingHouseIds.filter((hid) => hid !== oldOwnerHouseId)

  // Fix capitalProvinceId if the revolting province was the old polity's capital
  const newOldCapProvinceId: ProvinceId =
    oldPolity.capitalProvinceId === provinceId
      ? ((Object.values(state.provinces).find(
          (p) => p !== undefined && p.polityId === oldPolityId && p.id !== provinceId,
        )?.id ?? '') as ProvinceId)
      : oldPolity.capitalProvinceId

  const updatedOldPolity =
    updatedOldOwnerHouse && updatedOldOwnerHouse.provinceIds.length === 0
      ? {
          ...oldPolity,
          active: !oldOwnerIsRuler || remainingHouseIds.length > 0,
          capitalProvinceId: newOldCapProvinceId,
        }
      : {
          ...oldPolity,
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
    polities: {
      ...ctx.state.polities,
      [newPolityId]: newPolityObj,
      [oldPolityId]: updatedOldPolity,
    },
  }

  // Assign leader offices for the new house and polity
  newState = createOfficeAssignment(
    newState,
    { kind: 'house' as const, id: newHouseId },
    'leader',
    newPersonId,
  )
  newState = createOfficeAssignment(
    newState,
    { kind: 'polity' as const, id: newPolityId },
    'leader',
    newPersonId,
  )

  // If old owner house became landless, deactivate and move members
  if (updatedOldOwnerHouse && updatedOldOwnerHouse.provinceIds.length === 0 && oldOwnerHouse) {
    const deactivatedOldHouse = { ...updatedOldOwnerHouse, active: false }
    const rulerHouseId = getPolityLeaderHouse(newState, oldPolityId)
    if (!rulerHouseId) {
      return ok({
        ctx: { ...ctx, state: newState },
        value: { polityId: newPolityId, houseId: newHouseId, personId: newPersonId },
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
      polityIds: [oldPolityId],
      provinceIds: [provinceId],
      summary: `${oldOwnerHouse.name} has fallen from power after losing all lands.`,
      reasons: [],
      effects: [],
    }
    ctx = { ...ctxE, events: [...ctxE.events, extinctEvent] }
  } else {
    ctx = { ...ctx, state: newState }
  }

  // Emit REVOLT_POLITY_FOUNDED event
  const { id: eventId, ctx: ctx4 } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: ctx4.state.currentYear,
    month: ctx4.state.currentMonth,
    type: 'REVOLT_POLITY_FOUNDED',
    importance: 'critical',
    actorIds: [newPersonId],
    houseIds: [newHouseId],
    polityIds: [newPolityId, oldPolityId],
    provinceIds: [provinceId],
    summary: `${newPolityObj.name} has been founded by ${newLeader.name} through revolt in ${province.name}!`,
    reasons: [],
    effects: [],
  }
  ctx = { ...ctx4, events: [...ctx4.events, event] }

  return ok({ ctx, value: { polityId: newPolityId, houseId: newHouseId, personId: newPersonId } })
}
