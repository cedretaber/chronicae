import type { TickContext } from '../tick/context'
import { makeEventId, createSimEvent } from '../tick/context'
import { nameParam, entityRef } from '../types/event'
import type { HouseId, PersonId, ProvinceId, PolityId, HoldingId } from '../types/ids'
import type { EventReason, EventEffect } from '../types/event'
import type { WorldState } from '../types/world'
import type { SimEvent } from '../types/event'
import type { CtxResult } from './result'
import { ok } from './result'
import { createOfficeAssignment, revokeOfficesByOrganization } from './officeMutations'
import { dispersePersonsToHouseless } from './houseMutations'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getHouseProvinceIdsByPolity, getPolityHouseIds } from '../selectors/polityRelations'
import { getPolityNameRefForEmit } from '../selectors/nameRefSelectors'
import {
  getHouseControlledProvinceIds,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'
import { syncClanActive } from './clanMutations'
import { removeRightsByHolder } from './politicalRightMutations'
import { getActorInfluenceInPolity } from '../selectors/influenceSelectors'
import type { SimulationConfig } from '../config/defaultConfig'
import { createLogger } from '../debug/logger'

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
  config: SimulationConfig,
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

  // 2) affectedPolityIds 内で最大 Influence を持つ active House (v0.42: 旧 Polity Share)
  let bestByShare: { houseId: HouseId; share: number } | undefined
  for (const polityId of affectedPolityIds) {
    for (const candidateId of getPolityHouseIds(state, polityId)) {
      if ((candidateId as string) === (extinctHouseId as string)) continue
      if (isExcluded(candidateId)) continue
      const candidate = state.houses[candidateId]
      if (!candidate || !candidate.active) continue
      const share = getActorInfluenceInPolity(
        state,
        config,
        { kind: 'house', id: candidateId },
        polityId,
      ).percent
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

  // 分家優先継承 + v0.36e 分割継承 — Phase 1 (decide): 滅亡前 state (ctx.state) を凍結したまま、
  // 各 Polity の継承先を決める。逐次 mutation を挟むと「先に継いだ家が controlled province
  // 最大になり global fallback で残りも総取り」する再集中が起きるため、評価は必ず凍結 state に行う。
  //
  // 断絶家に active な分家 (cadet) があれば、それを最優先で継がせる (parentHouseId/cadetHouseIds
  // を活用)。kin リストは凍結 state から 1 回だけ算出し、i % kin.length の巡回で割り当てる:
  //   - cadet が 1 家 → 全 Polity をその分家が継ぐ (王朝が唯一の分家として存続)
  //   - cadet が複数 → 巡回で複数分家に分散 (v0.36e の単一家独占防止と両立)
  //   - cadet 不在 → parent house (あれば) → それも無ければ従来の chooseReceiverHouse + usedReceivers 散らし
  // kin 経路は同一王朝内での集約であり「無関係な家のグローバル rich-get-richer」とは別物。
  const inheritedPolityIds = [...(ctx.state.polityIndex.byOwnerHouse[houseId] ?? [])]
  const cadetHeirs = house.cadetHouseIds
    .filter((id) => {
      const h = ctx.state.houses[id]
      return Boolean(h && h.active && h.kind !== 'system')
    })
    .sort((a, b) => a.localeCompare(b))
  const parentHeir: HouseId[] =
    house.parentHouseId !== undefined && ctx.state.houses[house.parentHouseId]?.active
      ? [house.parentHouseId]
      : []
  const kin: HouseId[] = cadetHeirs.length > 0 ? cadetHeirs : parentHeir
  const usedReceivers = new Set<string>()
  const polityReceivers = new Map<PolityId, HouseId>()
  for (let i = 0; i < inheritedPolityIds.length; i++) {
    const polityId = inheritedPolityIds[i]!
    let r: HouseId | undefined
    if (kin.length > 0) {
      r = kin[i % kin.length]
    } else {
      r = chooseReceiverHouse(ctx.state, ctx.config, houseId, [polityId], usedReceivers)
      // 除外で候補が尽きた場合のみ緩和して重複継承を許容する (85 家規模では実質発生しない)
      if (r === undefined) r = chooseReceiverHouse(ctx.state, ctx.config, houseId, [polityId])
    }
    if (r !== undefined) {
      polityReceivers.set(polityId, r)
      usedReceivers.add(r)
    }
  }

  // members の移籍先 (narrative のみ — 土地は polityReceivers で個別に動く): 先頭 Polity の
  // 継承先を主継承先とする。Polity を持たない滅亡 (在野没落) は従来スコープで 1 家を選ぶ。
  const receiverHouseId: HouseId | undefined =
    (inheritedPolityIds.length > 0 ? polityReceivers.get(inheritedPolityIds[0]!) : undefined) ??
    chooseReceiverHouse(ctx.state, ctx.config, houseId, affectedPolityIds)

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
    // v0.42 §6.4: household right は holder House の絶家で即時失効 (silent cascade)
    stateForClanSync = removeRightsByHolder(stateForClanSync, { kind: 'house', id: houseId })
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
    const polityNameRef = getPolityNameRefForEmit(chainState, polityId)
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
      summary: `${polityNameRef.nameKey}'s ruling house changed from ${house.nameKey} to ${receiverHouse?.nameKey ?? polityReceiverHouseId} after the extinction.`,
      reasons: [] as EventReason[],
      effects: [] as EventEffect[],
      // i18n fields from createSimEvent pattern
      messageKey: 'polity.owner_changed_extinction',
      messageParams: {
        polity: nameParam(polityNameRef.category, polityNameRef.nameKey),
        oldHouse: nameParam('house', house.nameKey),
        newHouse: nameParam('house', receiverHouse?.nameKey ?? ''),
      },
      entityRefs: [
        entityRef('house', houseId, 'from_house', house.nameKey),
        entityRef('house', polityReceiverHouseId, 'to_house', receiverHouse?.nameKey),
        entityRef('polity', polityId, 'polity', polityNameRef.nameKey),
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

  // 財産継承: 断絶家の wealth を Polity 継承先へ按分する (受領 Polity 数で比例配分、端数は主
  //   継承先 receiverHouseId へ)。継承先は polityReceivers を normative source とするため、分家
  //   優先で kin が receiver になっていれば wealth も自動的に kin へ流れる。Polity を持たない
  //   没落 (polityReceivers 空) は継承先が定まらないため据え置き。
  const inheritedWealth = extinctHouseObj.wealth
  let extinctWealthAfter = inheritedWealth
  if (inheritedWealth > 0 && polityReceivers.size > 0) {
    const shareCount = new Map<HouseId, number>()
    for (const r of polityReceivers.values()) {
      shareCount.set(r, (shareCount.get(r) ?? 0) + 1)
    }
    const totalShares = [...shareCount.values()].reduce((a, b) => a + b, 0)
    const sortedReceivers = [...shareCount.keys()].sort((a, b) => a.localeCompare(b))
    const alloc = new Map<HouseId, number>()
    let distributed = 0
    for (const r of sortedReceivers) {
      const amt = Math.floor((inheritedWealth * (shareCount.get(r) ?? 0)) / totalShares)
      alloc.set(r, amt)
      distributed += amt
    }
    const remainder = inheritedWealth - distributed
    if (remainder > 0) alloc.set(receiverHouseId, (alloc.get(receiverHouseId) ?? 0) + remainder)
    for (const [rId, amt] of alloc) {
      if (amt <= 0) continue
      const rh = newHouses[rId]
      if (rh) newHouses[rId] = { ...rh, wealth: rh.wealth + amt }
    }
    extinctWealthAfter = 0
  }

  newHouses[houseId] = {
    ...extinctHouseObj,
    active: false,
    memberIds: [],
    wealth: extinctWealthAfter,
  }

  let stateForClanSync: WorldState = { ...resultCtx.state, houses: newHouses }
  // v0.42 §6.4: household right は holder House の絶家で即時失効 (silent cascade)
  stateForClanSync = removeRightsByHolder(stateForClanSync, { kind: 'house', id: houseId })
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
