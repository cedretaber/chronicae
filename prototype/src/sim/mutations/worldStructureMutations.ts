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
import { createOfficeAssignment, revokeOfficesByOrganization } from './officeMutations'
import { markPersonDead, movePersonToHouse } from './personMutations'
import { dispersePersonsToAnonymousHouse, addPersonToAnonymousHouse } from './houseMutations'
import { ANONYMOUS_HOUSE_ID } from '../types/landContract'
import { getHouseLeader, getPolityLeader, getPolityLeaderHouse } from '../selectors/officeSelectors'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { generatePolityName } from '../selectors/polityNamingService'
import {
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getPolityHouseIds,
} from '../selectors/polityRelations'
import {
  getHouseControlledProvinceIds,
  getProvinceEffectiveOwnerHouseId,
  getLandContractGrantor,
  getGrantorRank,
} from '../selectors/landContractSelectors'
import { transferLandContractGrantee } from './landContractMutations'
import { installHoldingPlaceholderBailiff } from './provinceOfficeMutations'
import { createOrganizationShare, removeOrganizationShare } from './shareMutations'
import type { PolityRank } from '../types/polity'
import { getHousePolitySharePercent } from '../selectors/shareSelectors'
import { createLogger } from '../debug/logger'
import { samplePerson } from '../helpers/personFactory'
import { defaultLandContractConfig } from '../config/landContractConfig'

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
    weekOfYear: resultCtx.state.currentWeekOfYear,
    type: 'HOUSE_SPLIT',
    importance: 'major',
    actorIds: [splitterPerson.id],
    houseIds: [input.houseId, newHouseId],
    polityIds: [housePolityId ?? ('' as PolityId)],
    provinceIds: splitProvinces,
    holdingIds: [],
    summary: `${splitterPerson.name} has split from ${house.name} to form a new house.`,
    reasons: [],
    effects: [],
  }
  resultCtx = { ...eventCtx, state: resultCtx.state, events: [...eventCtx.events, splitEvent] }

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_SPLIT', {
    year: resultCtx.state.currentYear,
    weekOfYear: resultCtx.state.currentWeekOfYear,
    house: input.houseId,
    result: 'split',
    new_house: newHouseId,
  })

  const { id: crisisId, ctx: crisisCtx } = makeEventId(resultCtx)
  const crisisEvent: SimEvent = {
    id: crisisId,
    year: resultCtx.state.currentYear,
    weekOfYear: resultCtx.state.currentWeekOfYear,
    type: 'SUCCESSION_CRISIS',
    importance: 'major',
    actorIds: [splitterPerson.id],
    houseIds: [input.houseId],
    polityIds: [housePolityId ?? ('' as PolityId)],
    provinceIds: [],
    holdingIds: [],
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

  // 4) 世界全体で最大 controlled Province 数を持つ active 通常 House
  let bestGlobal: { houseId: HouseId; count: number } | undefined
  for (const candidate of Object.values(state.houses)) {
    if (!candidate || !candidate.active) continue
    if (candidate.kind === 'system') continue
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

  // v0.17 §5.6.1 + 終末防止: 世界に他に active 通常 House が残らないなら絶滅させない。
  // 「最後の通常 House」を kept active で残し、polity が成立し続けるようにする。
  let otherActiveNormalCount = 0
  for (const otherIdStr of Object.keys(ctx.state.houses)) {
    const otherId = otherIdStr as HouseId
    if (otherId === houseId) continue
    const other = ctx.state.houses[otherId]
    if (!other || !other.active) continue
    if (other.kind === 'system') continue
    otherActiveNormalCount++
  }
  if (otherActiveNormalCount === 0) {
    // 最後の通常 House は絶滅させない (Stage B 末で導入された終末防止策)
    const log = createLogger(ctx.config.debug)
    log.log('LAST_NORMAL_HOUSE_GUARD', {
      year: ctx.state.currentYear,
      weekOfYear: ctx.state.currentWeekOfYear,
      house: houseId,
    })
    return ctx
  }

  // event 用 polityIds は affectedPolityIds を使う（喪失前のスナップショット）
  const eventPolityIds = affectedPolityIds.length > 0 ? affectedPolityIds : []

  const receiverHouseId = chooseReceiverHouse(ctx.state, houseId, affectedPolityIds)

  if (!receiverHouseId) {
    // v0.17 §5.6: 受け継ぎ家が見つからない場合、living non-placeholder member を AnonymousHouse に散らす。
    // dead / placeholder member は元 house に残し、house は active=false とする。
    let workingState = ctx.state
    const livingMemberIds: PersonId[] = []
    for (const memberId of house.memberIds) {
      const p = workingState.persons[memberId]
      if (!p || !p.alive || p.kind === 'placeholder') continue
      livingMemberIds.push(memberId)
    }

    const disperseResult = dispersePersonsToAnonymousHouse(workingState, {
      houseId,
      year: workingState.currentYear,
    })
    if (disperseResult.ok) workingState = disperseResult.value

    const newHouses = { ...workingState.houses }
    const extinctHouseObj = newHouses[houseId]
    if (!extinctHouseObj) return ctx
    newHouses[houseId] = {
      ...extinctHouseObj,
      active: false,
      memberIds: extinctHouseObj.memberIds,
    }
    const finalState = { ...workingState, houses: newHouses }
    let eventCtx: TickContext = { ...ctx, state: finalState }

    if (livingMemberIds.length > 0) {
      const { id: dispersedEventId, ctx: ec1 } = makeEventId(eventCtx)
      const dispersedEvent: SimEvent = {
        id: dispersedEventId,
        year: finalState.currentYear,
        weekOfYear: finalState.currentWeekOfYear,
        type: 'HOUSE_MEMBERS_DISPERSED',
        importance: 'normal',
        actorIds: livingMemberIds,
        houseIds: [houseId, ANONYMOUS_HOUSE_ID],
        polityIds: [],
        provinceIds: [],
        holdingIds: [],
        summary: `The remnants of ${house.name} dispersed into obscurity.`,
        reasons: [],
        effects: [],
      }
      eventCtx = { ...ec1, events: [...ec1.events, dispersedEvent] }
    }

    const { id: eventId, ctx: ec2 } = makeEventId(eventCtx)
    const event: SimEvent = {
      id: eventId,
      year: finalState.currentYear,
      weekOfYear: finalState.currentWeekOfYear,
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      actorIds: [],
      houseIds: [houseId],
      polityIds: eventPolityIds,
      provinceIds: [],
      holdingIds: [],
      summary: `${house.name} has become extinct with no surviving house to inherit its legacy.`,
      reasons: [],
      effects: [],
    }
    return { ...ec2, events: [...ec2.events, event] }
  }

  let resultCtx = ctx
  const sortedProvinceIds = [...getHouseControlledProvinceIds(resultCtx.state, houseId)].sort()

  // v0.16 §22.3: extinct House が ownerHouse である Polity すべてを receiver House に継承させる
  // (王朝交代)。LandContracts は変更しない (Polity と Province の関係は不変、ownerHouse のみ差し替え)。
  // - Polity.ownerHouseId = receiver
  // - polityIndex.byOwnerHouse 同期更新
  // - polity:leader Office を receiver の leader に差し替え
  // - POLITY_OWNER_CHANGED event 発火
  const inheritedPolityIds = [...(resultCtx.state.polityIndex.byOwnerHouse[houseId] ?? [])]
  let chainState = resultCtx.state
  const ownerChangedEvents: SimEvent[] = []
  for (const polityId of inheritedPolityIds) {
    const polity = chainState.polities[polityId]
    if (!polity) continue

    // Polity.ownerHouseId 更新
    chainState = {
      ...chainState,
      polities: {
        ...chainState.polities,
        [polityId]: { ...polity, ownerHouseId: receiverHouseId },
      },
    }

    // polityIndex.byOwnerHouse 更新
    const oldSlot = chainState.polityIndex.byOwnerHouse[houseId] ?? []
    const newSlot = chainState.polityIndex.byOwnerHouse[receiverHouseId] ?? []
    chainState = {
      ...chainState,
      polityIndex: {
        byOwnerHouse: {
          ...chainState.polityIndex.byOwnerHouse,
          [houseId]: oldSlot.filter((id) => id !== polityId),
          [receiverHouseId]: newSlot.includes(polityId) ? newSlot : [...newSlot, polityId],
        },
      },
    }

    // polity:leader Office を receiver House の leader に差し替え
    chainState = revokeOfficesByOrganization(chainState, { kind: 'polity', id: polityId }, 'leader')
    const newLeaderId = getHouseLeader(chainState, receiverHouseId)
    if (newLeaderId) {
      chainState = createOfficeAssignment(
        chainState,
        { kind: 'polity', id: polityId },
        'leader',
        newLeaderId,
      )
    }

    // POLITY_OWNER_CHANGED イベントを後でまとめて発火するため記録
    const receiverHouse = chainState.houses[receiverHouseId]
    ownerChangedEvents.push({
      id: '' as ReturnType<typeof makeEventId>['id'], // 後で発番
      year: chainState.currentYear,
      weekOfYear: chainState.currentWeekOfYear,
      type: 'POLITY_OWNER_CHANGED',
      importance: 'major',
      actorIds: [],
      houseIds: [houseId, receiverHouseId],
      polityIds: [polityId],
      provinceIds: [],
      holdingIds: [],
      summary: `${polity.name}'s ruling house changed from ${house.name} to ${receiverHouse?.name ?? receiverHouseId} after the extinction.`,
      reasons: [],
      effects: [],
    })
  }
  resultCtx = { ...resultCtx, state: chainState }

  // POLITY_OWNER_CHANGED イベントの ID を採番して emit
  for (const partial of ownerChangedEvents) {
    const { id: eventId, ctx: ec } = makeEventId(resultCtx)
    resultCtx = { ...ec, events: [...ec.events, { ...partial, id: eventId }] }
  }

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
    weekOfYear: finalState.currentWeekOfYear,
    type: 'HOUSE_EXTINCT',
    importance: 'major',
    actorIds: [],
    houseIds: [houseId, receiverHouseId],
    polityIds: eventPolityIds,
    provinceIds: sortedProvinceIds,
    holdingIds: [],
    summary:
      inheritedPolityIds.length > 0
        ? `${house.name} has become extinct; its realm is inherited by another house.`
        : `${house.name} has become extinct; its legacy passes to another house.`,
    reasons: [],
    effects: [],
  }

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_EXTINCT', {
    year: finalState.currentYear,
    weekOfYear: finalState.currentWeekOfYear,
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
// Create Rebel Polity (v0.18-pre)
// v0.16 §17 で生成された Rebel Polity を commonwealth として恒常運用する形に書き換え:
//   - rank = min(5, max(4, terminalRank+1))
//   - bailiff を placeholder に installPlaceholderBailiff
//   - rebel Person は AnonymousHouse 所属 (Rebel House は生成しない)
//   - Polity.kind = 'commonwealth'、ownerHouseId は undefined のまま (永続)
//   - polity:leader Office のみ rebel Person に付与 (house:leader は不在)
// 将来「家の設立」イベントで AnonymousHouse から新規 House を立て上げ、dynasty 樹立可能。
// ============================================================================

export function createRebelPolity(
  ctx: TickContext,
  input: { provinceId: ProvinceId; rebelClass: PopClass; oldPolityId: PolityId },
): CtxResult<{ polityId: PolityId; personId: PersonId }> {
  const { provinceId, rebelClass, oldPolityId } = input
  const config = ctx.config
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province)
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `createRebelPolity: province not found: ${provinceId}`,
    })

  const oldPolity = state.polities[oldPolityId]
  if (!oldPolity)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `createRebelPolity: old polity not found: ${oldPolityId}`,
    })

  const oldOwnerHouseId = getProvinceEffectiveOwnerHouseId(state, provinceId)
  const oldOwnerHouse = oldOwnerHouseId ? state.houses[oldOwnerHouseId] : undefined

  // Pre-generate IDs (v0.18-pre: Rebel House は作らないので HouseId は不要)
  const { id: newPolityId, ctx: ctx1 } = makePolityId(ctx)
  const { id: newPersonId, ctx: ctx2 } = makePersonId(ctx1)
  ctx = ctx2

  // Generate polity name (rulingHouseId は不使用: province_revolt_independence origin は
  // capitalProvinceId から命名する)
  const { name: newPolityName, rng: rng0 } = generatePolityName(ctx.state, ctx.config, ctx.rng, {
    origin: 'province_revolt_independence',
    provinceIds: [provinceId],
    capitalProvinceId: provinceId,
    founderPersonId: newPersonId,
    sourcePolityId: oldPolityId,
    rebelClass,
  })
  ctx = { ...ctx, rng: rng0 }

  // Generate leader (§17 step 4: sex 50/50, age range from config)
  const { value: sexRoll, rng: rngSex } = randomInt(ctx.rng, 0, 1)
  ctx = { ...ctx, rng: rngSex }
  const leaderSex: 'male' | 'female' = sexRoll === 0 ? 'male' : 'female'
  const { name: leaderName, rng: rng1 } = pickNameBySex(leaderSex, ctx.rng)
  ctx = { ...ctx, rng: rng1 }

  const [ageMin, ageMax] = defaultLandContractConfig.rebelLeaderAgeRange
  const { value: age, rng: rng2 } = randomInt(ctx.rng, ageMin, ageMax)
  ctx = { ...ctx, rng: rng2 }
  const { value: ambition, rng: rng3 } = randomInt(ctx.rng, 7, 10)
  ctx = { ...ctx, rng: rng3 }
  const { value: caution, rng: rng4 } = randomInt(ctx.rng, 2, 7)
  ctx = { ...ctx, rng: rng4 }
  const { value: legacyPrestige, rng: rng5 } = randomInt(ctx.rng, 5, 20)
  ctx = { ...ctx, rng: rng5 }

  // v0.18-pre: rebel Person は AnonymousHouse 所属。dynasty 樹立は将来「家の設立」イベントで。
  const { value: newLeader, rng: rngAfterLeader } = samplePerson(ctx.rng, ctx.config, {
    id: newPersonId,
    name: leaderName,
    sex: leaderSex,
    age,
    houseId: ANONYMOUS_HOUSE_ID,
    birthStatus: 'unknown',
    traits: { ambition: ambition / 10, caution: caution / 10 },
    legacyPrestige,
  })
  ctx = { ...ctx, rng: rngAfterLeader }

  // v0.16 §17: Rebel rank = min(5, max(4, terminalRank+1))
  const terminalRank = oldPolity.rank
  const rebelRank: PolityRank = Math.min(5, Math.max(4, terminalRank + 1)) as PolityRank

  // v0.18-pre: Rebel Polity は commonwealth。kind = 'commonwealth' により
  // polityOwnerConsistencySystem / successionSystem の補充ロジックを skip させ、
  // ownerHouseId === undefined を恒常的に許容する。
  const newPolityObj: Polity = {
    id: newPolityId,
    name: newPolityName,
    treasury: config.revoltPolityInitialTreasury,
    legacyPrestige: config.revoltPolityInitialLegacyPrestige,
    adminPower: 0,
    active: true,
    capitalProvinceId: provinceId,
    rank: rebelRank,
    kind: 'commonwealth',
  }

  // v0.16: Holding の polityControl のみリセット。所有変更は LandContract chain で表現する。
  const updatedHoldings = { ...ctx.state.holdings }
  for (const holdingId of province.holdingIds) {
    const holding = updatedHoldings[holdingId]
    if (holding) {
      updatedHoldings[holdingId] = {
        ...holding,
        polityControl: config.provinceRevoltNewCountryControl,
      }
    }
  }

  // v0.16: 旧 ownerHouse の Province 帰属は LandContract chain 経由で動的に決まるため House 自体は触らない。
  // ただし seat が当該 Province にあった場合の seat 移動は別 system に委ねる (Stage A では skip)。

  // v0.18-pre: Rebel Polity は commonwealth なので polityIndex.byOwnerHouse には登録しない。
  // rebel Person は addPersonToAnonymousHouse 経由で AnonymousHouse.memberIds に追加する。
  let newState: WorldState = {
    ...ctx.state,
    holdings: updatedHoldings,
    polities: {
      ...ctx.state.polities,
      [newPolityId]: newPolityObj,
    },
  }

  const addPersonResult = addPersonToAnonymousHouse(newState, { person: newLeader })
  if (!addPersonResult.ok) {
    return err(addPersonResult.error)
  }
  newState = addPersonResult.value

  // v0.16 §17 step 6: Rebel Polity の OrganizationShare = rebel leader (Person) に rawPower 100%
  // shareUpdateSystem の次回年次更新で再計算されるが、初期値として rebel leader 単独を置く
  newState = createOrganizationShare(
    newState,
    { kind: 'polity', id: newPolityId },
    { kind: 'person', id: newPersonId },
    100,
  )

  // v0.20: 各 Holding の terminal LandContract grantee を newPolityId に差し替え
  for (const holdingId of province.holdingIds) {
    const holdingChain = newState.landContractIndex.byHolding[holdingId] ?? []
    const terminalId = holdingChain[holdingChain.length - 1]
    if (terminalId) {
      newState = transferLandContractGrantee(newState, terminalId, newPolityId)
    }
  }

  // v0.16 §17: 当該 Province の bailiff を新 Polity 配下の placeholder に installHoldingPlaceholderBailiff
  for (const holdingId of province.holdingIds) {
    newState = installHoldingPlaceholderBailiff(newState, {
      holdingId,
      appointingPolityId: newPolityId,
      year: newState.currentYear,
      week: newState.currentWeekOfYear,
    })
  }

  const oldOwnerIsRuler =
    oldOwnerHouseId !== undefined && getPolityLeaderHouse(state, oldPolityId) === oldOwnerHouseId
  void oldOwnerIsRuler

  // v0.18-pre: polity:leader のみ rebel Person に付与 (house:leader は rebel に固有の House がないので作らない)
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
          weekOfYear: ctxE.state.currentWeekOfYear,
          type: 'HOUSE_EXTINCT',
          importance: 'major',
          actorIds: [],
          houseIds: [oldOwnerHouseId],
          polityIds: [oldPolityId],
          provinceIds: [provinceId],
          holdingIds: [],
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
    weekOfYear: ctx4.state.currentWeekOfYear,
    type: 'REVOLT_POLITY_FOUNDED',
    importance: 'critical',
    actorIds: [newPersonId],
    houseIds: [],
    polityIds: [newPolityId, oldPolityId],
    provinceIds: [provinceId],
    holdingIds: [],
    summary: `${newPolityObj.name} has been founded by ${newLeader.name} through revolt in ${province.name}!`,
    reasons: [],
    effects: [],
  }
  ctx = { ...ctx4, events: [...ctx4.events, event] }

  return ok({ ctx, value: { polityId: newPolityId, personId: newPersonId } })
}

// ============================================================================
// v0.18 Stage B §12.5: disbandRebelPolity
// revolt_negotiation の妥協成立または鎮圧成功時に Rebel commonwealth Polity を解散する。
// createRebelPolity の逆操作を担当 (LandContract grantee 復元 / Office revoke / Share 削除
// / placeholder Bailiff 切り替え / leader 死亡処理 / Polity inactive)。
// ============================================================================

export type RebelLeaderAftermath = 'returned_to_obscurity' | 'vanished' | 'executed' | 'exiled'

const REBEL_AFTERMATH_NARRATIONS: Record<RebelLeaderAftermath, string> = {
  returned_to_obscurity: 'has returned to obscurity',
  vanished: 'has vanished without a trace',
  executed: 'has been executed',
  exiled: 'has been exiled',
}

export type DisbandRebelPolityInput = {
  rebelPolityId: PolityId
  restoreToPolityId: PolityId
  provinceId: ProvinceId
  leaderAftermath: RebelLeaderAftermath
  reason: 'settlement' | 'suppression'
}

export function disbandRebelPolity(
  ctx: TickContext,
  input: DisbandRebelPolityInput,
): CtxResult<void> {
  const rebelPolity = ctx.state.polities[input.rebelPolityId]
  if (!rebelPolity) {
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `disbandRebelPolity: rebel Polity ${input.rebelPolityId} not found`,
    })
  }
  if (rebelPolity.kind !== 'commonwealth') {
    return err({
      code: 'POLITY_INACTIVE',
      message: `disbandRebelPolity: Polity ${input.rebelPolityId} is not a commonwealth`,
    })
  }
  const restorePolity = ctx.state.polities[input.restoreToPolityId]
  if (!restorePolity || !restorePolity.active) {
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `disbandRebelPolity: restore target Polity ${input.restoreToPolityId} not active`,
    })
  }
  const province = ctx.state.provinces[input.provinceId]
  if (!province) {
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `disbandRebelPolity: Province ${input.provinceId} not found`,
    })
  }

  let state = ctx.state

  // v0.20: 各 Holding の terminal LandContract grantee を restoreToPolityId に戻す
  //    rank 不変条件 (§25 #7: grantor rank < grantee rank) を満たさない場合は abort
  for (const hid of province.holdingIds) {
    const holdingChain = state.landContractIndex.byHolding[hid] ?? []
    const terminalId = holdingChain[holdingChain.length - 1]
    if (!terminalId) continue
    const terminalContract = state.landContracts[terminalId]
    if (!terminalContract) continue
    if ((terminalContract.granteePolityId as string) !== (input.rebelPolityId as string)) continue
    const grantor = getLandContractGrantor(state, terminalId)
    if (grantor) {
      const grantorRank = getGrantorRank(state, grantor)
      if (grantorRank >= restorePolity.rank) {
        return err({
          code: 'INTEGRITY_VIOLATION',
          message: `disbandRebelPolity: restore would violate rank invariant (grantor rank ${grantorRank} >= restore polity rank ${restorePolity.rank})`,
        })
      }
    }
    state = transferLandContractGrantee(state, terminalId, input.restoreToPolityId)
  }

  // 2. Rebel Polity の active polity:leader Office を revoke
  //    rebel leader を取得しておく (markPersonDead は revoke 後では取れなくなる)
  const rebelLeaderId = getPolityLeader(state, input.rebelPolityId)
  state = revokeOfficesByOrganization(state, { kind: 'polity', id: input.rebelPolityId }, 'leader')

  // 3. Rebel Polity 関連の OrganizationShare を全削除
  const orgKey = `polity:${input.rebelPolityId}`
  const shareIds = state.shareIndex.byOrganization[orgKey] ?? []
  for (const shareId of [...shareIds]) {
    state = removeOrganizationShare(state, shareId)
  }

  // 4. placeholder Bailiff を restoreToPolityId に切り替える
  //    (rebel polity が任命していた placeholder bailiff を vacate し、restore polity の
  //    placeholder bailiff を再 install。次 tick の bailiffAppointmentSystem が通常ルールで
  //    本任命する。IntegrityCheck §25 #23 違反を avoid するための immediate placeholder)
  const restoreProvince = state.provinces[input.provinceId]
  if (restoreProvince) {
    for (const restoreHoldingId of restoreProvince.holdingIds) {
      state = installHoldingPlaceholderBailiff(state, {
        holdingId: restoreHoldingId,
        appointingPolityId: input.restoreToPolityId,
        year: state.currentYear,
        week: state.currentWeekOfYear,
      })
    }
  }

  // 5. rebel leader を死亡処理 (markPersonDead 内部で revokeOfficesByHolder 連鎖)
  //    estateSettlementSystem は tick 早期に走っているため、tick 末 IntegrityCheck #11
  //    (dead person must have wealth === 0) を満たすため wealth も明示的にクリアする
  if (rebelLeaderId !== undefined) {
    const deadResult = markPersonDead(state, rebelLeaderId)
    if (deadResult.ok) {
      state = deadResult.value
      const deadPerson = state.persons[rebelLeaderId]
      if (deadPerson && deadPerson.wealth > 0) {
        state = {
          ...state,
          persons: {
            ...state.persons,
            [rebelLeaderId]: { ...deadPerson, wealth: 0 },
          },
        }
      }
    }
  }

  // 6. Polity を inactive にする
  const rebelPolityNow = state.polities[input.rebelPolityId]
  if (rebelPolityNow) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [input.rebelPolityId]: { ...rebelPolityNow, active: false },
      },
    }
  }

  let nextCtx: TickContext = { ...ctx, state }

  // 7. event 発火
  const { id: eventId, ctx: ctxEvent } = makeEventId(nextCtx)
  const aftermathText = REBEL_AFTERMATH_NARRATIONS[input.leaderAftermath]
  const restoreName = ctxEvent.state.polities[input.restoreToPolityId]?.name ?? 'the realm'
  const provinceName = ctxEvent.state.provinces[input.provinceId]?.name ?? input.provinceId
  const summary =
    input.reason === 'settlement'
      ? `The revolt in ${provinceName} has been settled by negotiation — its leader ${aftermathText}, and the province returns to ${restoreName}.`
      : `The revolt in ${provinceName} has been suppressed — its leader ${aftermathText}, and the province returns to ${restoreName}.`
  const event: SimEvent = {
    id: eventId,
    year: ctxEvent.state.currentYear,
    weekOfYear: ctxEvent.state.currentWeekOfYear,
    type: input.reason === 'settlement' ? 'REVOLT_SETTLED' : 'REVOLT_SUPPRESSED',
    importance: 'major',
    actorIds: rebelLeaderId !== undefined ? [rebelLeaderId] : [],
    houseIds: [],
    polityIds: [input.rebelPolityId, input.restoreToPolityId],
    provinceIds: [input.provinceId],
    holdingIds: [],
    summary,
    reasons: [],
    effects: [],
  }
  nextCtx = { ...ctxEvent, events: [...ctxEvent.events, event] }

  return ok({ ctx: nextCtx, value: undefined })
}
