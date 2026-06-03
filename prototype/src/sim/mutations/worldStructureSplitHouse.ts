import type { TickContext } from '../tick/context'
import { makeHouseId, createSimEvent } from '../tick/context'
import { nameParam, entityRef } from '../types/event'
import { randomFloat } from '../rng/rng'
import type { HouseId, PersonId, ProvinceId } from '../types/ids'
import type { House } from '../types/house'
import type { WorldState } from '../types/world'
import type { CtxResult } from './result'
import { ok, err } from './result'
import { createOfficeAssignment } from './officeMutations'
import { movePersonToHouse } from './personMutations'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import { initializeHouseShares } from '../tick/shareUpdateSystem'
import { removePersonSharesInHouse } from './shareMutations'
import { addHouseToClan } from './clanMutations'
import { createLogger } from '../debug/logger'

// ============================================================================
// Split House Orchestration
// Extracted from houseSplitSystem.ts (execution phase)
// ============================================================================

export function splitHouse(
  ctx: TickContext,
  input: { houseId: HouseId; splitterPersonId: PersonId; fromSuccession?: boolean },
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
  // 調査 §1 (low): randomFloat が返す advance 後 rng を伝播する (旧コードは ctx.rng を
  // 再利用しており controlFraction の draw が後続の name picking と相関していた)。
  const { value: controlFraction, rng: rngAfterControlDraw } = randomFloat(ctx.rng)
  let rngAfterControl = rngAfterControlDraw
  const F = controlMin + controlFraction * (controlMax - controlMin)
  const sortedProvinceIds = [...getHouseControlledProvinceIds(ctx.state, input.houseId)].sort()
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

  // v0.16: 親 Polity ID は polityIndex.byOwnerHouse 経由で取得。Stage A では実際の Polity 帰属変更は行わない (Stage B で LandContract 操作に置換)
  const newHousePolityId = getHousePrimaryPolityId(ctxWithId.state, house.id)

  let newHouseNameKey: string
  if (ctx.namePoolService) {
    const usedKeys = new Set(
      Object.values(ctx.state.houses)
        .filter((h): h is NonNullable<typeof h> => h !== undefined)
        .map((h) => h.nameKey),
    )
    const { value: key, rng: rngH } = ctx.namePoolService.pickUniqueNameKey(
      rngAfterControl,
      usedKeys,
      { nameCultureId: 'western', category: 'house', path: ['noble'] },
      'house',
      Object.keys(ctx.state.houses).length,
    )
    rngAfterControl = rngH
    newHouseNameKey = key
  } else {
    newHouseNameKey = `house_${Object.keys(ctx.state.houses).length}`
  }

  const newHouseObj: House = {
    id: newHouseId,
    nameKey: newHouseNameKey,
    active: true,
    memberIds: [splitterPerson.id],
    deceasedMemberIds: [],
    founderId: splitterPerson.id,
    cadetHouseIds: [],
    legacyPrestige: Math.floor(house.legacyPrestige * 0.5),
    wealth: newHouseWealth,
    seatProvinceId: firstSplitProvince,
    parentHouseId: house.id,
    creationKind: 'cadet_branch',
    creationReason: input.fromSuccession ? 'succession' : 'house_split',
    ...(house.clanId !== undefined && { clanId: house.clanId }),
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

  const splitProvincesSet = new Set<string>(splitProvinces.map((id) => id as string))
  const parentControlled = getHouseControlledProvinceIds(resultCtx.state, input.houseId)
  const newParentSeatProvinceId: ProvinceId = splitProvincesSet.has(parentHouse.seatProvinceId)
    ? (parentControlled.find((pid) => !splitProvincesSet.has(pid as string)) ??
      parentHouse.seatProvinceId)
    : parentHouse.seatProvinceId
  const newParentMemberIds = parentHouse.memberIds.filter((pid) => !familyPersonIds.has(pid))
  const newParentWealth = parentHouse.wealth - newHouseWealth

  const newParentHouseObj = {
    ...parentHouse,
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

  if (house.clanId !== undefined) {
    resultCtx = { ...resultCtx, state: addHouseToClan(resultCtx.state, house.clanId, newHouseId) }
  }

  // v0.16 TODO Stage B: split された Province を新 House 配下に移すには新規 sub-Polity を作る必要がある。
  // Stage A では Province 帰属の更新を行わない (新 House は controlled 0 で start)。
  void newHousePolityId

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

  // Phase D: Clean up moved members' shares in the parent house
  for (const personId of newMemberIds) {
    resultCtx = {
      ...resultCtx,
      state: removePersonSharesInHouse(resultCtx.state, personId, input.houseId),
    }
  }

  // Phase D: Initialize shares for the new house
  resultCtx = {
    ...resultCtx,
    state: initializeHouseShares(resultCtx.state, ctx.config, newHouseId),
  }

  // Phase D: Set lastSplitWeek cooldown on both houses
  const parentAfterSplit = resultCtx.state.houses[input.houseId]
  const childAfterSplit = resultCtx.state.houses[newHouseId]
  if (parentAfterSplit && childAfterSplit) {
    resultCtx = {
      ...resultCtx,
      state: {
        ...resultCtx.state,
        houses: {
          ...resultCtx.state.houses,
          [input.houseId]: { ...parentAfterSplit, lastSplitWeek: resultCtx.state.absoluteWeek },
          [newHouseId]: { ...childAfterSplit, lastSplitWeek: resultCtx.state.absoluteWeek },
        },
      },
    }
  }

  const housePolityId = getHousePrimaryPolityId(resultCtx.state, house.id)

  // v0.16 TODO Stage B: split された Province を新 House 配下に移すには新規 sub-Polity を作る必要がある。
  // Stage A では Province 帰属の更新を行わない (新 House は controlled 0 で start)。
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

  // CADET_HOUSE_FOUNDED event
  const { event: cadetEvent, ctx: cadetCtx } = createSimEvent(resultCtx, {
    type: 'CADET_HOUSE_FOUNDED',
    importance: 'major',
    messageKey: 'house.cadet_founded',
    messageParams: {
      person: nameParam('person', splitterPerson.nameKey),
      house: nameParam('house', newHouseNameKey),
      parentHouse: nameParam('house', house.nameKey),
    },
    entityRefs: [
      entityRef('person', splitterPerson.id, 'founder', splitterPerson.nameKey),
      entityRef('house', newHouseId, 'house', newHouseNameKey),
      entityRef('house', input.houseId, 'parent_house', house.nameKey),
    ],
  })
  resultCtx = { ...cadetCtx, state: resultCtx.state, events: [...cadetCtx.events, cadetEvent] }

  // HOUSE_SPLIT event
  const { event: splitEvent, ctx: eventCtx } = createSimEvent(resultCtx, {
    type: 'HOUSE_SPLIT',
    importance: 'major',
    messageKey: 'house.split',
    messageParams: {
      person: nameParam('person', splitterPerson.nameKey),
      house: nameParam('house', house.nameKey),
    },
    entityRefs: [
      entityRef('person', splitterPerson.id, 'splitter', splitterPerson.nameKey),
      entityRef('house', input.houseId, 'from_house', house.nameKey),
      entityRef('house', newHouseId, 'to_house'),
      ...(housePolityId ? [entityRef('polity', housePolityId, 'polity')] : []),
    ],
  })
  resultCtx = { ...eventCtx, state: resultCtx.state, events: [...eventCtx.events, splitEvent] }

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_SPLIT', {
    year: resultCtx.state.currentYear,
    weekOfYear: resultCtx.state.currentWeekOfYear,
    house: input.houseId,
    result: 'split',
    new_house: newHouseId,
  })

  // SUCCESSION_CRISIS event
  if (input.fromSuccession) {
    const { event: crisisEvent, ctx: crisisCtx } = createSimEvent(resultCtx, {
      type: 'SUCCESSION_CRISIS',
      importance: 'major',
      messageKey: 'succession.crisis_split',
      messageParams: {
        house: nameParam('house', house.nameKey),
        polity: housePolityId
          ? (() => {
              const ref = getPolityNameRefForEmit(resultCtx.state, housePolityId)
              return nameParam(ref.category, ref.nameKey)
            })()
          : '',
      },
      entityRefs: [
        entityRef('house', input.houseId, 'crisis_house', house.nameKey),
        entityRef('person', splitterPerson.id, 'splitter', splitterPerson.nameKey),
        ...(housePolityId ? [entityRef('polity', housePolityId, 'polity')] : []),
      ],
    })
    resultCtx = { ...crisisCtx, state: resultCtx.state, events: [...crisisCtx.events, crisisEvent] }
  }

  return ok({ ctx: resultCtx, value: { newHouseId } })
}

// ============================================================================
// House Extinction Orchestration
// Extracted from houseExtinctionSystem.ts
// ============================================================================
