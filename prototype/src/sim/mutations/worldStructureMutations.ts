import type { TickContext } from '../tick/context'
import {
  makeHouseId,
  makePersonId,
  makePolityId,
  makeEventId,
  createSimEvent,
} from '../tick/context'
import { nameParam, entityRef } from '../types/event'
import { randomFloat, randomInt } from '../rng/rng'
import type {
  HouseId,
  PersonId,
  ProvinceId,
  PolityId,
  HoldingId,
  LandContractId,
} from '../types/ids'
import type { EventReason, EventEffect } from '../types/event'
import type { House } from '../types/house'
import type { Polity } from '../types/polity'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import type { PopClass } from '../types/popGroup'
import type { CtxResult } from './result'
import { ok, err } from './result'
import { createOfficeAssignment, revokeOfficesByOrganization } from './officeMutations'
import { markPersonDead, movePersonToHouse } from './personMutations'
import { dispersePersonsToHouseless, addHouselessPerson } from './houseMutations'
import { getHouseLeader, getPolityLeader } from '../selectors/officeSelectors'
import { pickNameBySex } from '../worldgen/nameGenerators'
import { generatePolityNameKey } from '../selectors/polityNamingService'
import {
  getHousePrimaryPolityId,
  getHouseProvinceIdsByPolity,
  getPolityHouseIds,
} from '../selectors/polityRelations'
import {
  getHouseControlledProvinceIds,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'
import { createOrganizationShare } from './shareMutations'
import { initializeHouseShares } from '../tick/shareUpdateSystem'
import { removePersonSharesInHouse } from './shareMutations'
import { addHouseToClan, syncClanActive } from './clanMutations'
import { getHousePolitySharePercent } from '../selectors/shareSelectors'
import { createLogger } from '../debug/logger'
import { samplePerson } from '../helpers/personFactory'
import { getHouselessPersons } from '../selectors/availabilitySelectors'
import { removeFactionMembership } from './factionMutations'
import { removeSharesByOrganization } from './shareMutations'
import { adjustPopAttitude, adjustHouseMembersAttitude } from './attitudeMutations'

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
  const { value: controlFraction } = randomFloat(ctx.rng)
  let rngAfterControl = ctx.rng
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
      ctxWithId.rng,
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
      fromHouse: nameParam('house', house.nameKey),
      toHouse: nameParam('house', newHouseNameKey),
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
          ? nameParam('polity', resultCtx.state.polities[housePolityId]?.nameKey ?? '')
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
// v0.36e 分割継承: excludeHouseIds で「既に他 Polity を割り当てた家」を全 stage からハード除外し、
// 同一家への再集中を防ぐ。除外で候補が尽きた場合は呼び出し側が excludeHouseIds なしで再試行する。
function chooseReceiverHouse(
  state: WorldState,
  extinctHouseId: HouseId,
  affectedPolityIds: PolityId[],
  excludeHouseIds?: ReadonlySet<string>,
): HouseId | undefined {
  const isExcluded = (id: HouseId): boolean =>
    excludeHouseIds !== undefined && excludeHouseIds.has(id)

  // 1) affectedPolityIds 内で最大 Province 数を持つ active House
  let bestByProvinceCount: { houseId: HouseId; count: number } | undefined
  for (const polityId of affectedPolityIds) {
    for (const candidateId of getPolityHouseIds(state, polityId)) {
      if ((candidateId as string) === (extinctHouseId as string)) continue
      if (isExcluded(candidateId)) continue
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
      if (isExcluded(candidateId)) continue
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
        if (isExcluded(ownerHouseId)) continue
        const ownerHouse = state.houses[ownerHouseId]
        if (ownerHouse && ownerHouse.active && ownerHouse.id !== extinctHouseId) {
          return ownerHouse.id
        }
      }
    }
  }

  // 4) 世界全体で最大 controlled Province 数を持つ active 通常 House。
  // count=0 の tie-break が挿入順に依存しないよう houseId 昇順で安定走査する。
  let bestGlobal: { houseId: HouseId; count: number } | undefined
  const sortedHouses = Object.values(state.houses).sort((a, b) =>
    (a.id as string).localeCompare(b.id),
  )
  for (const candidate of sortedHouses) {
    if (!candidate || !candidate.active) continue
    if (candidate.kind === 'system') continue
    if ((candidate.id as string) === (extinctHouseId as string)) continue
    if (isExcluded(candidate.id)) continue
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

  // v0.36e 分割継承 — Phase 1 (decide): 滅亡前 state (ctx.state) を凍結したまま、
  // 各 Polity の継承先を独立に決める。逐次 mutation を挟むと「先に継いだ家が controlled
  // province 最大になり global fallback で残りも総取り」する再集中が起きるため、評価は
  // 必ず凍結 state に対して行う。usedReceivers でハード除外し別々の家へ分配する。
  const inheritedPolityIds = [...(ctx.state.polityIndex.byOwnerHouse[houseId] ?? [])]
  const usedReceivers = new Set<string>()
  const polityReceivers = new Map<PolityId, HouseId>()
  for (const polityId of inheritedPolityIds) {
    let r = chooseReceiverHouse(ctx.state, houseId, [polityId], usedReceivers)
    // 除外で候補が尽きた場合のみ緩和して重複継承を許容する (85 家規模では実質発生しない)
    if (r === undefined) r = chooseReceiverHouse(ctx.state, houseId, [polityId])
    if (r !== undefined) {
      polityReceivers.set(polityId, r)
      usedReceivers.add(r)
    }
  }

  // members の移籍先 (narrative のみ — 土地は polityReceivers で個別に動く): 先頭 Polity の
  // 継承先を主継承先とする。Polity を持たない滅亡 (在野没落) は従来スコープで 1 家を選ぶ。
  const receiverHouseId: HouseId | undefined =
    (inheritedPolityIds.length > 0 ? polityReceivers.get(inheritedPolityIds[0]!) : undefined) ??
    chooseReceiverHouse(ctx.state, houseId, affectedPolityIds)

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

    const disperseResult = dispersePersonsToHouseless(workingState, {
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
    let stateForClanSync: WorldState = { ...workingState, houses: newHouses }
    if (extinctHouseObj.clanId !== undefined) {
      stateForClanSync = syncClanActive(stateForClanSync, extinctHouseObj.clanId)
    }
    const finalState = stateForClanSync
    let eventCtx: TickContext = { ...ctx, state: finalState }

    if (livingMemberIds.length > 0) {
      const { event: dispersedEvent, ctx: ec1 } = createSimEvent(eventCtx, {
        type: 'HOUSE_MEMBERS_DISPERSED',
        importance: 'normal',
        messageKey: 'house.members_dispersed',
        messageParams: {
          house: nameParam('house', house.nameKey),
        },
        entityRefs: [entityRef('house', houseId, 'house', house.nameKey)],
      })
      eventCtx = { ...ec1, events: [...ec1.events, dispersedEvent] }
    }

    const { event: event2, ctx: ec2 } = createSimEvent(eventCtx, {
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      messageKey: 'house.extinct',
      messageParams: {
        house: nameParam('house', house.nameKey),
      },
      entityRefs: [entityRef('house', houseId, 'house', house.nameKey)],
    })
    return { ...ec2, events: [...ec2.events, event2] }
  }

  let resultCtx = ctx

  // v0.16 §22.3: extinct House が ownerHouse である Polity すべてを receiver House に継承させる
  // (王朝交代)。LandContracts は変更しない (Polity と Province の関係は不変、ownerHouse のみ差し替え)。
  // - Polity.ownerHouseId = receiver
  // - polityIndex.byOwnerHouse 同期更新
  // - polity:leader Office を receiver の leader に差し替え
  // - POLITY_OWNER_CHANGED event 発火
  let chainState = resultCtx.state
  const ownerChangedEvents: SimEvent[] = []
  for (const polityId of inheritedPolityIds) {
    const polity = chainState.polities[polityId]
    if (!polity) continue
    // 分割継承: この Polity の継承先 (Phase 1 で凍結 state から決定済み)
    const polityReceiverHouseId = polityReceivers.get(polityId)
    if (polityReceiverHouseId === undefined) continue

    // Polity.ownerHouseId 更新
    chainState = {
      ...chainState,
      polities: {
        ...chainState.polities,
        [polityId]: { ...polity, ownerHouseId: polityReceiverHouseId },
      },
    }

    // polityIndex.byOwnerHouse 更新
    const oldSlot = chainState.polityIndex.byOwnerHouse[houseId] ?? []
    const newSlot = chainState.polityIndex.byOwnerHouse[polityReceiverHouseId] ?? []
    chainState = {
      ...chainState,
      polityIndex: {
        byOwnerHouse: {
          ...chainState.polityIndex.byOwnerHouse,
          [houseId]: oldSlot.filter((id) => id !== polityId),
          [polityReceiverHouseId]: newSlot.includes(polityId) ? newSlot : [...newSlot, polityId],
        },
      },
    }

    // polity:leader Office を receiver House の leader に差し替え
    chainState = revokeOfficesByOrganization(chainState, { kind: 'polity', id: polityId }, 'leader')
    const newLeaderId = getHouseLeader(chainState, polityReceiverHouseId)
    if (newLeaderId) {
      chainState = createOfficeAssignment(
        chainState,
        { kind: 'polity', id: polityId },
        'leader',
        newLeaderId,
      )
    }

    // POLITY_OWNER_CHANGED イベントを後でまとめて発火するため記録
    const receiverHouse = chainState.houses[polityReceiverHouseId]
    const partialEvent = {
      id: '' as ReturnType<typeof makeEventId>['id'], // 後で発番
      year: chainState.currentYear,
      weekOfYear: chainState.currentWeekOfYear,
      type: 'POLITY_OWNER_CHANGED' as const,
      importance: 'major' as const,
      actorIds: [] as PersonId[],
      houseIds: [houseId, polityReceiverHouseId],
      polityIds: [polityId],
      provinceIds: [] as ProvinceId[],
      holdingIds: [] as HoldingId[],
      summary: `${polity.nameKey}'s ruling house changed from ${house.nameKey} to ${receiverHouse?.nameKey ?? polityReceiverHouseId} after the extinction.`,
      reasons: [] as EventReason[],
      effects: [] as EventEffect[],
      // i18n fields from createSimEvent pattern
      messageKey: 'polity.owner_changed_extinction',
      messageParams: {
        polity: nameParam('polity', polity.nameKey),
        fromHouse: nameParam('house', house.nameKey),
        toHouse: nameParam('house', receiverHouse?.nameKey ?? ''),
      },
      entityRefs: [
        entityRef('house', houseId, 'from_house', house.nameKey),
        entityRef('house', polityReceiverHouseId, 'to_house', receiverHouse?.nameKey),
        entityRef('polity', polityId, 'polity', polity.nameKey),
      ],
    }
    ownerChangedEvents.push(partialEvent)
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

  let stateForClanSync: WorldState = { ...resultCtx.state, houses: newHouses }
  if (extinctHouseObj.clanId !== undefined) {
    stateForClanSync = syncClanActive(stateForClanSync, extinctHouseObj.clanId)
  }
  const finalState = stateForClanSync

  const { event: event3, ctx: eventCtx } = createSimEvent(
    { ...resultCtx, state: finalState },
    {
      type: 'HOUSE_EXTINCT',
      importance: 'major',
      messageKey:
        inheritedPolityIds.length > 0 ? 'house.extinct_inherited' : 'house.extinct_legacy',
      messageParams: {
        house: nameParam('house', house.nameKey),
      },
      entityRefs: [
        entityRef('house', houseId, 'extinct_house', house.nameKey),
        entityRef('house', receiverHouseId, 'inheriting_house'),
      ],
    },
  )

  const log = createLogger(ctx.config.debug)
  log.log('HOUSE_EXTINCT', {
    year: finalState.currentYear,
    weekOfYear: finalState.currentWeekOfYear,
    house: houseId,
    type: 'normal',
    receiver: receiverHouseId,
  })

  return { ...eventCtx, state: finalState, events: [...eventCtx.events, event3] }
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
// v0.39 B-2: selectOrCreateCommonwealthLeader
// 在野人物の優先選出 + 新規生成。spec §14.1-14.2。
// ============================================================================

export function selectOrCreateCommonwealthLeader(ctx: TickContext): {
  personId: PersonId
  ctx: TickContext
  created: boolean
} {
  const state = ctx.state
  const houselessIds = getHouselessPersons(state)

  let bestId: PersonId | undefined
  let bestScore = -Infinity

  for (const pid of houselessIds) {
    const p = state.persons[pid]
    if (!p || !p.alive) continue
    if (p.kind === 'placeholder') continue

    const activeOfficeIds = state.officeIndex.byHolderPerson[pid as string] ?? []
    const hasActiveOffice = activeOfficeIds.some((oid) => {
      const o = state.officeAssignments[oid]
      return o && o.active
    })
    if (hasActiveOffice) continue

    const activeHoldingOfficeIds = state.holdingOfficeIndex.byHolderPerson[pid] ?? []
    const hasActiveHoldingOffice = activeHoldingOfficeIds.some((hoid) => {
      const ho = state.holdingOfficeAssignments[hoid]
      return ho && ho.active
    })
    if (hasActiveHoldingOffice) continue

    const score =
      p.abilities.charisma + p.abilities.command + p.abilities.insight + p.traits.ambition * 100
    if (score > bestScore || (score === bestScore && (pid as string) < (bestId as string))) {
      bestScore = score
      bestId = pid
    }
  }

  if (bestId !== undefined) {
    return { personId: bestId, ctx, created: false }
  }

  const { id: newPersonId, ctx: ctx1 } = makePersonId(ctx)
  ctx = ctx1

  const { value: sexRoll, rng: rngSex } = randomInt(ctx.rng, 0, 1)
  ctx = { ...ctx, rng: rngSex }
  const leaderSex: 'male' | 'female' = sexRoll === 0 ? 'male' : 'female'

  let leaderNameKey: string
  if (ctx.namePoolService) {
    const { value: key, rng: rng1 } = ctx.namePoolService.pickNameKey(ctx.rng, {
      nameCultureId: ctx.config.nameCultureId,
      category: 'person',
      path: [leaderSex],
    })
    ctx = { ...ctx, rng: rng1 }
    leaderNameKey = key
  } else {
    const { name, rng: rng1 } = pickNameBySex(leaderSex, ctx.rng)
    ctx = { ...ctx, rng: rng1 }
    leaderNameKey = name
  }

  const { value: age, rng: rng2 } = randomInt(ctx.rng, 25, 55)
  ctx = { ...ctx, rng: rng2 }
  const { value: ambition, rng: rng3 } = randomInt(ctx.rng, 7, 10)
  ctx = { ...ctx, rng: rng3 }
  const { value: caution, rng: rng4 } = randomInt(ctx.rng, 2, 5)
  ctx = { ...ctx, rng: rng4 }
  const { value: legacyPrestige, rng: rng5 } = randomInt(ctx.rng, 5, 15)
  ctx = { ...ctx, rng: rng5 }

  const { value: newLeader, rng: rngAfterLeader } = samplePerson(ctx.rng, ctx.config, {
    id: newPersonId,
    nameKey: leaderNameKey,
    sex: leaderSex,
    age,
    birthStatus: 'unknown',
    traits: { ambition: ambition / 10, caution: caution / 10 },
    legacyPrestige,
  })
  ctx = { ...ctx, rng: rngAfterLeader }

  const addResult = addHouselessPerson(ctx.state, newLeader)
  if (addResult.ok) {
    ctx = { ...ctx, state: addResult.value }
  }

  return { personId: newPersonId, ctx, created: true }
}

// ============================================================================
// v0.39 B-1: createNegotiatingCommonwealth
// 交渉用 commonwealth を生成する。土地の LandContract 移転は行わない。
// revoltState は呼び出し側で DiplomaticPlay 生成後に設定する。
// ============================================================================

export type CreateNegotiatingCommonwealthInput = {
  holdingId: HoldingId
  provinceId: ProvinceId
  popClass: PopClass
  targetPolityId: PolityId
}

export function createNegotiatingCommonwealth(
  ctx: TickContext,
  input: CreateNegotiatingCommonwealthInput,
): CtxResult<{ polityId: PolityId; personId: PersonId }> {
  const { holdingId, provinceId, popClass, targetPolityId } = input
  const state = ctx.state

  const province = state.provinces[provinceId]
  if (!province)
    return err({
      code: 'PROVINCE_NOT_FOUND',
      message: `createNegotiatingCommonwealth: province not found: ${provinceId}`,
    })

  const targetPolity = state.polities[targetPolityId]
  if (!targetPolity)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `createNegotiatingCommonwealth: target polity not found: ${targetPolityId}`,
    })

  const { id: newPolityId, ctx: ctx1 } = makePolityId(ctx)
  ctx = ctx1

  const { personId: leaderPersonId, ctx: ctx2, created } = selectOrCreateCommonwealthLeader(ctx)
  ctx = ctx2

  if (!created) {
    let leaderState = ctx.state
    const membershipIds = leaderState.factionIndex.byMember[leaderPersonId] ?? []
    for (const msId of membershipIds) {
      const ms = leaderState.factionMemberships[msId]
      if (!ms || !ms.active) continue
      const result = removeFactionMembership(leaderState, msId)
      if (result.ok) leaderState = result.value
    }
    ctx = { ...ctx, state: leaderState }
  }

  const { nameKey: newPolityNameKey, rng: rng0 } = generatePolityNameKey(
    ctx.state,
    ctx.config,
    ctx.rng,
    {
      origin: 'province_revolt_independence',
      provinceIds: [provinceId],
      capitalProvinceId: provinceId,
      founderPersonId: leaderPersonId,
      sourcePolityId: targetPolityId,
      rebelClass: popClass,
    },
    ctx.namePoolService,
  )
  ctx = { ...ctx, rng: rng0 }

  const newPolityObj: Polity = {
    id: newPolityId,
    nameKey: newPolityNameKey,
    treasury: 0,
    legacyPrestige: 0,
    adminPower: 0,
    active: true,
    capitalProvinceId: provinceId,
    rank: 5,
    kind: 'commonwealth',
    origin: {
      kind: 'popular_revolt',
      originalPolityId: targetPolityId,
      provinceId,
      holdingIds: [holdingId],
      popClass,
      leaderPersonId,
      startedWeek: state.absoluteWeek,
    },
  }

  let newState: WorldState = {
    ...ctx.state,
    polities: {
      ...ctx.state.polities,
      [newPolityId]: newPolityObj,
    },
  }

  newState = createOrganizationShare(
    newState,
    { kind: 'polity', id: newPolityId },
    { kind: 'person', id: leaderPersonId },
    100,
  )

  newState = createOfficeAssignment(
    newState,
    { kind: 'polity' as const, id: newPolityId },
    'leader',
    leaderPersonId,
  )

  ctx = { ...ctx, state: newState }

  const leaderPerson = newState.persons[leaderPersonId]
  const { event: revoltEvent, ctx: ctx3 } = createSimEvent(ctx, {
    type: 'REVOLT_POLITY_FOUNDED',
    importance: 'critical',
    messageKey: 'revolt.polity_founded',
    messageParams: {
      polity: nameParam('polity', newPolityObj.nameKey),
      person: nameParam('person', leaderPerson?.nameKey ?? ''),
      province: nameParam('province', province.nameKey),
    },
    entityRefs: [
      entityRef('person', leaderPersonId, 'leader', leaderPerson?.nameKey),
      entityRef('polity', newPolityId, 'new_polity', newPolityObj.nameKey),
      entityRef('polity', targetPolityId, 'old_polity', targetPolity.nameKey),
      entityRef('province', provinceId, 'province', province.nameKey),
    ],
  })
  ctx = { ...ctx3, events: [...ctx3.events, revoltEvent] }

  void created

  return ok({ ctx, value: { polityId: newPolityId, personId: leaderPersonId } })
}

// ============================================================================
// v0.39 B-6: dissolveNegotiatingCommonwealth
// negotiating / revolting commonwealth を解散する。
// disbandRebelPolity と異なり LandContract 移転なし・leader を無条件に殺さない。
// ============================================================================

export type DissolveCommonwealthInput = {
  commonwealthPolityId: PolityId
  leaderOutcome: 'alive' | 'executed' | 'pardoned'
}

export function dissolveNegotiatingCommonwealth(
  ctx: TickContext,
  input: DissolveCommonwealthInput,
): CtxResult<void> {
  const polity = ctx.state.polities[input.commonwealthPolityId]
  if (!polity)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `dissolveNegotiatingCommonwealth: polity ${input.commonwealthPolityId} not found`,
    })

  let state = ctx.state

  const leaderId = getPolityLeader(state, input.commonwealthPolityId)

  state = revokeOfficesByOrganization(
    state,
    { kind: 'polity', id: input.commonwealthPolityId },
    'leader',
  )
  state = removeSharesByOrganization(state, { kind: 'polity', id: input.commonwealthPolityId })

  if (input.leaderOutcome === 'executed' && leaderId !== undefined) {
    const deadResult = markPersonDead(state, leaderId, { deathCircumstance: 'natural' })
    if (deadResult.ok) {
      state = deadResult.value
      const deadPerson = state.persons[leaderId]
      if (deadPerson && deadPerson.wealth > 0) {
        state = {
          ...state,
          persons: {
            ...state.persons,
            [leaderId]: { ...deadPerson, wealth: 0 },
          },
        }
      }
    }
  }

  // §14.6: pardoned leader の prestige ペナルティ
  if (input.leaderOutcome === 'pardoned' && leaderId !== undefined) {
    const leader = state.persons[leaderId]
    if (leader) {
      state = {
        ...state,
        persons: {
          ...state.persons,
          [leaderId]: {
            ...leader,
            legacyPrestige: Math.max(0, leader.legacyPrestige - 10),
          },
        },
      }
    }
  }

  const updatedPolity = state.polities[input.commonwealthPolityId]
  if (updatedPolity) {
    state = {
      ...state,
      polities: {
        ...state.polities,
        [input.commonwealthPolityId]: {
          ...updatedPolity,
          active: false,
          revoltState: undefined,
        },
      },
    }
  }

  return ok({ ctx: { ...ctx, state }, value: undefined })
}

// ============================================================================
// v0.39 C-5: establishCommonwealth — revolt War 勝利時
// ============================================================================

export function establishCommonwealth(
  ctx: TickContext,
  input: {
    commonwealthPolityId: PolityId
    revoltSeizureContractIds: LandContractId[]
    leaderPersonId: PersonId
  },
): CtxResult<void> {
  let state = ctx.state

  // 1. revoltState → established
  const cw = state.polities[input.commonwealthPolityId]
  if (!cw)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: `establishCommonwealth: ${input.commonwealthPolityId}`,
    })
  state = {
    ...state,
    polities: {
      ...state.polities,
      [input.commonwealthPolityId]: { ...cw, revoltState: { kind: 'established' } },
    },
  }

  // 2. revolt_seizure 契約の specialStatus を除去（正式契約化）
  for (const contractId of input.revoltSeizureContractIds) {
    const c = state.landContracts[contractId]
    if (c?.specialStatus?.kind === 'revolt_seizure') {
      const updated = { ...c }
      delete updated.specialStatus
      state = { ...state, landContracts: { ...state.landContracts, [contractId]: updated } }
    }
  }

  // 3. Leader prestige boost
  const leader = state.persons[input.leaderPersonId]
  if (leader) {
    state = {
      ...state,
      persons: {
        ...state.persons,
        [input.leaderPersonId]: {
          ...leader,
          legacyPrestige: Math.min(100, leader.legacyPrestige + 15),
        },
      },
    }
  }

  // 4. POP attitude boost toward commonwealth (§14.5)
  if (cw.origin?.kind === 'popular_revolt') {
    for (const hid of cw.origin.holdingIds) {
      const popIds = state.popIndex.byHolding[hid]
      if (!popIds) continue
      for (const popId of popIds) {
        const r = adjustPopAttitude(
          state,
          popId,
          { kind: 'polity', id: input.commonwealthPolityId },
          { affection: 15, respect: 10 },
        )
        if (r.ok) state = r.value
      }
    }
    // 4b. Old owner house attitude penalty (§14.5)
    const origPolity = state.polities[cw.origin.originalPolityId]
    if (origPolity?.ownerHouseId !== undefined) {
      const r = adjustHouseMembersAttitude(
        state,
        origPolity.ownerHouseId,
        { kind: 'polity', id: input.commonwealthPolityId },
        { affection: -20, respect: -10 },
      )
      if (r.ok) state = r.value
    }
  }

  let nextCtx: TickContext = { ...ctx, state }
  const capitalProvince = state.provinces[cw.capitalProvinceId]
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_POLITY_ESTABLISHED',
    importance: 'critical',
    messageKey: 'revolt.triumphant',
    messageParams: {
      province: nameParam('province', capitalProvince?.nameKey ?? cw.capitalProvinceId),
    },
    entityRefs: [
      entityRef('polity', input.commonwealthPolityId, 'commonwealth', cw.nameKey),
      entityRef('person', input.leaderPersonId, 'leader'),
      entityRef('province', cw.capitalProvinceId, 'province', capitalProvince?.nameKey),
    ],
  })
  nextCtx = { ...ctxEv, events: [...ctxEv.events, event] }

  return ok({ ctx: nextCtx, value: undefined })
}

// ============================================================================
// v0.39 C-5: suppressRevolt — revolt War 鎮圧時
// ============================================================================

import { eliminateContractFromChain as eliminateContract } from './landContractMutations'

export function suppressRevolt(
  ctx: TickContext,
  input: {
    commonwealthPolityId: PolityId
    revoltSeizureContractIds: LandContractId[]
    holdingIds: HoldingId[]
  },
): CtxResult<void> {
  let state = ctx.state

  // 1. revolt_seizure 契約を削除
  for (const contractId of input.revoltSeizureContractIds) {
    const c = state.landContracts[contractId]
    if (c) {
      state = eliminateContract(state, contractId)
    }
  }

  // 2. commonwealth 解散（leader outcome: 50% executed / 50% pardoned）
  let nextCtx: TickContext = { ...ctx, state }
  const { value: roll, rng: nextRng } = randomFloat(nextCtx.rng)
  nextCtx = { ...nextCtx, rng: nextRng }
  const leaderOutcome: 'executed' | 'pardoned' = roll < 0.5 ? 'executed' : 'pardoned'
  const dissolveResult = dissolveNegotiatingCommonwealth(nextCtx, {
    commonwealthPolityId: input.commonwealthPolityId,
    leaderOutcome,
  })
  if (dissolveResult.ok) {
    nextCtx = dissolveResult.value.ctx
  }

  // 3. Holding に lastRevoltSuppressedWeek 記録
  let updatedState = nextCtx.state
  for (const holdingId of input.holdingIds) {
    const h = updatedState.holdings[holdingId]
    if (h) {
      updatedState = {
        ...updatedState,
        holdings: {
          ...updatedState.holdings,
          [holdingId]: { ...h, lastRevoltSuppressedWeek: updatedState.absoluteWeek },
        },
      }
    }
  }
  nextCtx = { ...nextCtx, state: updatedState }

  // 4. Event
  const cw = nextCtx.state.polities[input.commonwealthPolityId]
  const capitalProvinceId = cw?.capitalProvinceId
  const capitalProv = capitalProvinceId ? nextCtx.state.provinces[capitalProvinceId] : undefined
  const originalPolityId =
    cw?.origin?.kind === 'popular_revolt' ? cw.origin.originalPolityId : undefined
  const originalPolity = originalPolityId ? nextCtx.state.polities[originalPolityId] : undefined
  const { event, ctx: ctxEv } = createSimEvent(nextCtx, {
    type: 'REVOLT_SUPPRESSED',
    importance: 'major',
    messageKey:
      leaderOutcome === 'executed' ? 'revolt.suppressed_executed' : 'revolt.suppressed_pardoned',
    messageParams: {
      province: nameParam('province', capitalProv?.nameKey ?? capitalProvinceId ?? ''),
      restorePolity: nameParam('polity', originalPolity?.nameKey ?? ''),
    },
    entityRefs: [
      entityRef('polity', input.commonwealthPolityId, 'commonwealth'),
      ...(originalPolityId
        ? [entityRef('polity', originalPolityId, 'restore_polity', originalPolity?.nameKey)]
        : []),
      ...(capitalProvinceId
        ? [entityRef('province', capitalProvinceId, 'province', capitalProv?.nameKey)]
        : []),
    ],
  })
  nextCtx = { ...ctxEv, events: [...ctxEv.events, event] }

  return ok({ ctx: nextCtx, value: undefined })
}
