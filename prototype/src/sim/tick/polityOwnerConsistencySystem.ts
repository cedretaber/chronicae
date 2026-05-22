import type { TickContext } from './context'
import { createSimEvent } from './context'
import type { PolityId, HouseId, ProvinceId, PersonId } from '../types/ids'
import type { WorldState } from '../types/world'
import { entityRef, nameParam } from '../types/event'
import {
  getPolityProvinceIds,
  getPolityHouseIds,
  getHouseProvinceIdsByPolity,
  getHouseSeatProvinceInPolity,
} from '../selectors/polityRelations'
import { getHouseLeader } from '../selectors/officeSelectors'
import { revokeOfficesByOrganization, createOfficeAssignment } from '../mutations/officeMutations'
import { removeSharesByOrganization } from '../mutations/shareMutations'
import { getProvinceDevelopmentFromHoldings } from '../selectors/landContractSelectors'

// v0.15 §10.2: 新 ownerHouse を選定する。
// 1) Polity 内所有 Province 数 desc
// 2) 同数なら Polity 内 Province の合計 development を local military proxy として desc
// 3) 同値なら house.legacyPrestige desc
// 4) 同値なら HouseId 昇順
function chooseOwner(
  ctx: TickContext,
  polityId: PolityId,
  eligibleHouseIds: HouseId[],
): HouseId | undefined {
  if (eligibleHouseIds.length === 0) return undefined
  const ranked = eligibleHouseIds
    .map((houseId) => {
      const house = ctx.state.houses[houseId]
      const provinceIdsInPolity = getHouseProvinceIdsByPolity(ctx.state, houseId, polityId)
      let holdingCount = 0
      for (const pid of provinceIdsInPolity) {
        holdingCount += ctx.state.provinces[pid]?.holdingIds.length ?? 0
      }
      let devSum = 0
      for (const pid of provinceIdsInPolity) {
        const p = ctx.state.provinces[pid]
        if (p) devSum += getProvinceDevelopmentFromHoldings(ctx.state, pid)
      }
      return {
        houseId,
        holdingCount,
        devSum,
        legacyPrestige: house?.legacyPrestige ?? 0,
      }
    })
    .sort((a, b) => {
      if (b.holdingCount !== a.holdingCount) return b.holdingCount - a.holdingCount
      if (b.devSum !== a.devSum) return b.devSum - a.devSum
      if (b.legacyPrestige !== a.legacyPrestige) return b.legacyPrestige - a.legacyPrestige
      return a.houseId.localeCompare(b.houseId)
    })
  return ranked[0]?.houseId
}

function emitPolityExtinct(
  ctx: TickContext,
  polityId: PolityId,
  _summary: string,
  messageKey: string,
): TickContext {
  const polity = ctx.state.polities[polityId]
  const polityName = nameParam('polity', polity?.nameKey ?? polityId)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_EXTINCT',
    importance: 'major',
    messageKey,
    messageParams: { polity: polityName },
    entityRefs: [entityRef('polity', polityId, 'polity', polity?.nameKey)],
  })
  return { ...c1, events: [...c1.events, event] }
}

function emitPolityLandless(ctx: TickContext, polityId: PolityId): TickContext {
  const polity = ctx.state.polities[polityId]
  const polityName = nameParam('polity', polity?.nameKey ?? polityId)
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_LANDLESS',
    importance: 'major',
    messageKey: 'polity.landless',
    messageParams: { polity: polityName },
    entityRefs: [entityRef('polity', polityId, 'polity', polity?.nameKey)],
  })
  return { ...c1, events: [...c1.events, event] }
}

function emitPolityOwnerChanged(
  ctx: TickContext,
  polityId: PolityId,
  oldOwnerId: HouseId | undefined,
  newOwnerId: HouseId,
  newCapitalProvinceId: ProvinceId,
): TickContext {
  const polity = ctx.state.polities[polityId]
  const newHouse = ctx.state.houses[newOwnerId]
  const capProv = ctx.state.provinces[newCapitalProvinceId]
  const polityName = nameParam('polity', polity?.nameKey ?? polityId)
  const newHouseName = nameParam('house', newHouse?.nameKey ?? newOwnerId)
  const capName = nameParam('province', capProv?.nameKey ?? newCapitalProvinceId)
  const messageKey = oldOwnerId ? 'polity.owner_changed' : 'polity.owner_changed_initial'
  const { event, ctx: c1 } = createSimEvent(ctx, {
    type: 'POLITY_OWNER_CHANGED',
    importance: 'major',
    messageKey,
    messageParams: {
      polity: polityName,
      new_owner: newHouseName,
      capital: capName,
    },
    entityRefs: [
      entityRef('polity', polityId, 'polity', polity?.nameKey),
      entityRef('house', newOwnerId, 'new_owner', newHouse?.nameKey),
      entityRef('province', newCapitalProvinceId, 'capital', capProv?.nameKey),
    ],
  })
  return { ...c1, events: [...c1.events, event] }
}

// owner 交代に伴い polity:leader Office も同月内に補充する（plan / §25.2 #10 を当月内成立させる）。
function replacePolityLeader(
  ctx: TickContext,
  polityId: PolityId,
  newOwnerHouseId: HouseId,
): TickContext {
  let state = revokeOfficesByOrganization(ctx.state, { kind: 'polity', id: polityId }, 'leader')
  const newLeaderId: PersonId | undefined = getHouseLeader(state, newOwnerHouseId)
  if (newLeaderId) {
    state = createOfficeAssignment(state, { kind: 'polity', id: polityId }, 'leader', newLeaderId)
  }
  return { ...ctx, state }
}

// v0.16: chain length 1 だと Polity 関連 House は ownerHouse 1 つだけになる。
// その owner が滅んで eligibleHouseIds が空になっても、Polity に granteed Province が残るなら
// LandContract grantee 不整合を防ぐため、世界中から active な通常 House を 1 つ拾って ownerHouse に
// 任命する。これにより「王朝交代」が常に起き、Polity 自体は landless になるまで存続する。
function findFallbackOwnerHouse(state: WorldState, excludeHouseId?: HouseId): HouseId | undefined {
  let best: { houseId: HouseId; legacyPrestige: number } | undefined
  for (const houseId of Object.keys(state.houses).sort()) {
    if (excludeHouseId !== undefined && houseId === excludeHouseId) continue
    const house = state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue
    // ownerHouse は seatProvinceId を持っているはず (chain length 1 想定では undefined 不可)
    if (!best || house.legacyPrestige > best.legacyPrestige) {
      best = { houseId: house.id, legacyPrestige: house.legacyPrestige }
    }
  }
  return best?.houseId
}

// polityIndex.byOwnerHouse を更新する: oldOwner から外し newOwner に追加。
function reassignPolityOwnership(
  state: WorldState,
  polityId: PolityId,
  oldOwnerId: HouseId | undefined,
  newOwnerId: HouseId,
): WorldState {
  const byOwnerHouse = { ...state.polityIndex.byOwnerHouse }
  if (oldOwnerId !== undefined) {
    const oldSlot = byOwnerHouse[oldOwnerId] ?? []
    byOwnerHouse[oldOwnerId] = oldSlot.filter((p: PolityId) => p !== polityId)
  }
  const newSlot = byOwnerHouse[newOwnerId] ?? []
  if (!newSlot.includes(polityId)) {
    byOwnerHouse[newOwnerId] = [...newSlot, polityId]
  }
  return {
    ...state,
    polityIndex: { byOwnerHouse },
  }
}

function deactivatePolityInline(ctx: TickContext, polityId: PolityId): TickContext {
  const polity = ctx.state.polities[polityId]
  if (!polity) return ctx
  let state = ctx.state
  state = revokeOfficesByOrganization(state, { kind: 'polity', id: polityId })
  state = removeSharesByOrganization(state, { kind: 'polity', id: polityId })
  state = {
    ...state,
    polities: { ...state.polities, [polityId]: { ...polity, active: false } },
  }
  return { ...ctx, state }
}

export function runPolityOwnerConsistencySystem(ctx: TickContext): TickContext {
  let currentCtx = ctx
  const polityIds = (Object.keys(currentCtx.state.polities) as PolityId[]).sort()

  for (const polityId of polityIds) {
    const polity = currentCtx.state.polities[polityId]
    if (!polity || !polity.active) continue

    // Step 1: provinceIds=0 なら POLITY_LANDLESS を発火し、inactive 化 + Share/Office 全削除 + POLITY_EXTINCT
    const provinceIds = getPolityProvinceIds(currentCtx.state, polityId)
    if (provinceIds.length === 0) {
      currentCtx = emitPolityLandless(currentCtx, polityId)
      currentCtx = deactivatePolityInline(currentCtx, polityId)
      currentCtx = emitPolityExtinct(
        currentCtx,
        polityId,
        `${polity.nameKey} has dissolved without remaining provinces.`,
        'polity.extinct_no_provinces',
      )
      continue
    }

    const eligibleHouseIds = getPolityHouseIds(currentCtx.state, polityId)

    // Step 2: ownerHouseId が undefined の場合の補充
    if (polity.ownerHouseId === undefined) {
      // v0.18-pre: commonwealth Polity は ownerHouseId === undefined を恒常状態として許容する
      // (Rebel Polity が第三国家に乗っ取られる現象の解消)。Polity.kind === 'commonwealth' なら補充スキップ。
      if (polity.kind === 'commonwealth') continue
      // v0.16: Polity に Province がまだ残っているなら、グローバルに active 通常 House を探して
      // 補充する (LandContract grantee 不整合防止)。それも無ければ POLITY_EXTINCT。
      const newOwnerId =
        eligibleHouseIds.length > 0
          ? chooseOwner(currentCtx, polityId, eligibleHouseIds)!
          : findFallbackOwnerHouse(currentCtx.state)
      if (newOwnerId === undefined) {
        currentCtx = deactivatePolityInline(currentCtx, polityId)
        currentCtx = emitPolityExtinct(
          currentCtx,
          polityId,
          `${polity.nameKey} has dissolved without an owning house.`,
          'polity.extinct_no_owner',
        )
        continue
      }
      const newCapital =
        getHouseSeatProvinceInPolity(currentCtx.state, newOwnerId, polityId) ?? provinceIds[0]!
      const updated = currentCtx.state.polities[polityId]
      if (!updated) continue
      const stateWithOwner: WorldState = {
        ...currentCtx.state,
        polities: {
          ...currentCtx.state.polities,
          [polityId]: {
            ...updated,
            ownerHouseId: newOwnerId,
            capitalProvinceId: newCapital,
          },
        },
      }
      currentCtx = {
        ...currentCtx,
        state: reassignPolityOwnership(stateWithOwner, polityId, undefined, newOwnerId),
      }
      currentCtx = replacePolityLeader(currentCtx, polityId, newOwnerId)
      currentCtx = emitPolityOwnerChanged(currentCtx, polityId, undefined, newOwnerId, newCapital)
      continue
    }

    // Step 3: ownerHouse 資格検査
    const ownerHouse = currentCtx.state.houses[polity.ownerHouseId]
    const ownerInvalid =
      !ownerHouse ||
      !ownerHouse.active ||
      !eligibleHouseIds.some((id) => (id as string) === (polity.ownerHouseId as string))

    if (!ownerInvalid) continue

    // v0.18-pre: commonwealth Polity に owner が一時的に set された状態は将来「家の設立」イベント
    // 等で起き得る。kind === 'commonwealth' のままなら invalid 検知でも入れ替えない (defensive)。
    if (polity.kind === 'commonwealth') continue

    // v0.16: eligibleHouseIds が空でも、Polity が provinces を持つ限り別 House を ownerHouse に
    // 任命する (LandContract grantee 不整合防止)。グローバル fallback で active 通常 House を探す。
    const oldOwnerId = polity.ownerHouseId
    const newOwnerId =
      eligibleHouseIds.length > 0
        ? chooseOwner(currentCtx, polityId, eligibleHouseIds)!
        : findFallbackOwnerHouse(currentCtx.state, oldOwnerId)
    if (newOwnerId === undefined) {
      // 世界に active 通常 House が 1 つも残っていない場合のみ extinct
      currentCtx = deactivatePolityInline(currentCtx, polityId)
      currentCtx = emitPolityExtinct(
        currentCtx,
        polityId,
        `${polity.nameKey} has dissolved after losing its owning house.`,
        'polity.extinct_lost_owner',
      )
      continue
    }
    const newCapital =
      getHouseSeatProvinceInPolity(currentCtx.state, newOwnerId, polityId) ?? provinceIds[0]!
    const updated = currentCtx.state.polities[polityId]
    if (!updated) continue
    const stateWithOwner: WorldState = {
      ...currentCtx.state,
      polities: {
        ...currentCtx.state.polities,
        [polityId]: {
          ...updated,
          ownerHouseId: newOwnerId,
          capitalProvinceId: newCapital,
        },
      },
    }
    currentCtx = {
      ...currentCtx,
      state: reassignPolityOwnership(stateWithOwner, polityId, oldOwnerId, newOwnerId),
    }
    currentCtx = replacePolityLeader(currentCtx, polityId, newOwnerId)
    currentCtx = emitPolityOwnerChanged(currentCtx, polityId, oldOwnerId, newOwnerId, newCapital)
  }

  return currentCtx
}
