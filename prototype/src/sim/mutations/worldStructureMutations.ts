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
import { getHouseLeader, getPolityLeaderHouse } from '../selectors/officeSelectors'
import {
  pickNameBySex,
  pickUniqueName,
  houseNamePool,
  houseName as houseNameFn,
} from '../worldgen/nameGenerators'
import { generatePolityName } from '../selectors/polityNamingService'
import {
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getPolityHouseIds,
} from '../selectors/polityRelations'
import {
  getHouseControlledProvinceIds,
  getProvinceTerminalContract,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'
import { transferLandContractGrantee } from './landContractMutations'
import { getHousePolitySharePercent } from '../selectors/shareSelectors'
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
  const newHouseObj: House = {
    id: newHouseId,
    name: splitterPerson.name + "'s House",
    active: true,
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

// v0.15 §22.3: メンバー / 残 Province 移住先 House を選定する。
// affectedPolityIds がスナップショット時点での関係 Polity 集合（所領喪失前）。
function chooseReceiverHouse(
  state: WorldState,
  extinctHouseId: HouseId,
  affectedPolityIds: PolityId[],
): HouseId | undefined {
  // 1) affectedPolityIds 内で最大 Province 数を持つ active House
  let bestByProvinceCount: { houseId: HouseId; count: number } | undefined
  for (const polityId of affectedPolityIds) {
    for (const candidateId of getPolityHouseIds(state, polityId)) {
      if ((candidateId as string) === (extinctHouseId as string)) continue
      const candidate = state.houses[candidateId]
      if (!candidate || !candidate.active) continue
      const count = getHouseProvinceIdsByPolity(state, candidateId, polityId).length
      if (!bestByProvinceCount || count > bestByProvinceCount.count) {
        bestByProvinceCount = { houseId: candidateId, count }
      }
    }
  }
  if (bestByProvinceCount) return bestByProvinceCount.houseId

  // 2) affectedPolityIds 内で最大 Polity Share を持つ active House
  let bestByShare: { houseId: HouseId; share: number } | undefined
  for (const polityId of affectedPolityIds) {
    for (const candidateId of getPolityHouseIds(state, polityId)) {
      if ((candidateId as string) === (extinctHouseId as string)) continue
      const candidate = state.houses[candidateId]
      if (!candidate || !candidate.active) continue
      const share = getHousePolitySharePercent(state, polityId, candidateId)
      if (!bestByShare || share > bestByShare.share) {
        bestByShare = { houseId: candidateId, share }
      }
    }
  }
  if (bestByShare) return bestByShare.houseId

  // 3) 旧 seatProvinceId 隣接 Province の effective owner House
  const extinctHouse = state.houses[extinctHouseId]
  if (extinctHouse) {
    const seat = state.provinces[extinctHouse.seatProvinceId]
    if (seat) {
      for (const neighborId of seat.neighbors) {
        const neighbor = state.provinces[neighborId]
        if (!neighbor) continue
        const ownerHouseId = getProvinceEffectiveOwnerHouseId(state, neighborId)
        if (!ownerHouseId) continue
        const ownerHouse = state.houses[ownerHouseId]
        if (ownerHouse && ownerHouse.active && ownerHouse.id !== extinctHouseId) {
          return ownerHouse.id
        }
      }
    }
  }

  // 4) 世界全体で最大 controlled Province 数を持つ active House
  let bestGlobal: { houseId: HouseId; count: number } | undefined
  for (const candidate of Object.values(state.houses)) {
    if (!candidate || !candidate.active) continue
    if ((candidate.id as string) === (extinctHouseId as string)) continue
    const count = getHouseControlledProvinceIds(state, candidate.id).length
    if (!bestGlobal || count > bestGlobal.count) {
      bestGlobal = { houseId: candidate.id, count }
    }
  }
  return bestGlobal?.houseId
}

function handleNormalHouseExtinction(
  ctx: TickContext,
  houseId: HouseId,
  affectedPolityIds: PolityId[],
): TickContext {
  const house = ctx.state.houses[houseId]
  if (!house) return ctx

  // event 用 polityIds は affectedPolityIds を使う（喪失前のスナップショット）
  const eventPolityIds = affectedPolityIds.length > 0 ? affectedPolityIds : []

  const receiverHouseId = chooseReceiverHouse(ctx.state, houseId, affectedPolityIds)

  if (!receiverHouseId) {
    // メンバーは inactive のまま House 解散。Polity の active 化は
    // PolityOwnerConsistencySystem に委ねるためここでは触らない。
    const newHouses = { ...ctx.state.houses }
    const extinctHouseObj = newHouses[houseId]
    if (!extinctHouseObj) return ctx
    newHouses[houseId] = { ...extinctHouseObj, active: false, memberIds: [] }
    const finalState = { ...ctx.state, houses: newHouses }
    const { id: eventId, ctx: eventCtx } = makeEventId({ ...ctx, state: finalState })
    const event: SimEvent = {
      id: eventId,
      year: finalState.currentYear,
      month: finalState.currentMonth,
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      actorIds: [],
      houseIds: [houseId],
      polityIds: eventPolityIds,
      provinceIds: [],
      summary: `${house.name} has become extinct with no surviving house to inherit its legacy.`,
      reasons: [],
      effects: [],
    }
    return { ...eventCtx, state: finalState, events: [...eventCtx.events, event] }
  }

  let resultCtx = ctx
  const sortedProvinceIds = [...getHouseControlledProvinceIds(resultCtx.state, houseId)].sort()

  // v0.16: extinct House の controlled Province は LandContract chain 経由で receiver の Polity に移す。
  // receiver House が owner である最初の Polity を target にする。なければ skip。
  const receiverPolityIds = resultCtx.state.polityIndex.byOwnerHouse[receiverHouseId] ?? []
  const targetPolityId = receiverPolityIds[0]
  let chainState = resultCtx.state
  if (targetPolityId !== undefined) {
    for (const pid of sortedProvinceIds) {
      const terminal = getProvinceTerminalContract(chainState, pid)
      if (!terminal) continue
      chainState = transferLandContractGrantee(chainState, terminal.id, targetPolityId)
    }
  }
  resultCtx = { ...resultCtx, state: chainState }

  const stateAfterMove = moveLivingMembersToHouse(resultCtx.state, houseId, receiverHouseId)
  resultCtx = { ...resultCtx, state: stateAfterMove }

  const newHouses = { ...resultCtx.state.houses }
  const extinctHouseObj = newHouses[houseId]
  if (!extinctHouseObj) return resultCtx
  newHouses[houseId] = {
    ...extinctHouseObj,
    active: false,
    memberIds: [],
  }

  const finalState = { ...resultCtx.state, houses: newHouses }

  const { id: eventId, ctx: eventCtx } = makeEventId({ ...resultCtx, state: finalState })
  const event: SimEvent = {
    id: eventId,
    year: finalState.currentYear,
    month: finalState.currentMonth,
    type: 'HOUSE_EXTINCT',
    importance: 'major',
    actorIds: [],
    houseIds: [houseId],
    polityIds: eventPolityIds,
    provinceIds: sortedProvinceIds,
    summary: `${house.name} has become extinct; lands inherited by another house.`,
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

// v0.15 §22.3: affectedPolityIds は所領喪失前の getHousePolityIds スナップショット。
// 移住先 House の選定スコープとして使う。
export type HouseExtinctionInput = {
  houseId: HouseId
  affectedPolityIds: PolityId[]
}

export function extinctHouse(ctx: TickContext, input: HouseExtinctionInput): CtxResult<void> {
  const { houseId, affectedPolityIds } = input
  const house = ctx.state.houses[houseId]
  if (!house) return ok({ ctx, value: undefined })

  const updatedCtx = handleNormalHouseExtinction(ctx, houseId, affectedPolityIds)
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

  const oldOwnerHouseId = getProvinceEffectiveOwnerHouseId(state, provinceId)
  const oldOwnerHouse = oldOwnerHouseId ? state.houses[oldOwnerHouseId] : undefined

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

  // v0.16: Province の polityControl のみリセット。所有変更は LandContract chain で表現する。
  const updatedProvince: typeof province = {
    ...province,
    polityControl: config.provinceRevoltNewCountryControl,
  }

  // v0.16: 旧 ownerHouse の Province 帰属は LandContract chain 経由で動的に決まるため House 自体は触らない。
  // ただし seat が当該 Province にあった場合の seat 移動は別 system に委ねる (Stage A では skip)。

  // Apply all state changes
  let newState: WorldState = {
    ...ctx.state,
    provinces: { ...ctx.state.provinces, [provinceId]: updatedProvince },
    persons: { ...ctx.state.persons, [newPersonId]: newLeader },
    houses: {
      ...ctx.state.houses,
      [newHouseId]: newHouseObj,
    },
    polities: {
      ...ctx.state.polities,
      [newPolityId]: newPolityObj,
    },
    polityIndex: {
      byOwnerHouse: {
        ...ctx.state.polityIndex.byOwnerHouse,
        [newHouseId]: [newPolityId],
      },
    },
  }

  // v0.16: 当該 Province の terminal LandContract grantee を newPolityId に差し替え
  const terminal = getProvinceTerminalContract(newState, provinceId)
  if (terminal) {
    newState = transferLandContractGrantee(newState, terminal.id, newPolityId)
  }

  const oldOwnerIsRuler =
    oldOwnerHouseId !== undefined && getPolityLeaderHouse(state, oldPolityId) === oldOwnerHouseId
  void oldOwnerIsRuler

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

  // v0.16: 旧 ownerHouse が landless になった場合の処理は LandContract chain selector 経由で判定する。
  if (oldOwnerHouseId !== undefined && oldOwnerHouse) {
    const remainingControlled = getHouseControlledProvinceIds(newState, oldOwnerHouseId)
    if (remainingControlled.length === 0) {
      const rulerHouseId = getPolityLeaderHouse(newState, oldPolityId)
      if (rulerHouseId && rulerHouseId !== oldOwnerHouseId) {
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
        updatedHouses[oldOwnerHouseId] = { ...oldOwnerHouse, active: false, memberIds: [] }
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
    } else {
      ctx = { ...ctx, state: newState }
    }
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
