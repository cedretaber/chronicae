import type { TickContext } from './context'
import type { PolityId, HouseId, ProvinceId, PersonId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { makeEventId } from './context'
import {
  getPolityProvinceIds,
  getPolityHouseIds,
  getHouseProvinceIdsByPolity,
  getHouseSeatProvinceInPolity,
} from '../selectors/polityRelations'
import { getHouseLeader } from '../selectors/officeSelectors'
import { revokeOfficesByOrganization, createOfficeAssignment } from '../mutations/officeMutations'
import { removeSharesByOrganization } from '../mutations/shareMutations'

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
      let devSum = 0
      for (const pid of provinceIdsInPolity) {
        const p = ctx.state.provinces[pid]
        if (p) devSum += p.development
      }
      return {
        houseId,
        provinceCount: provinceIdsInPolity.length,
        devSum,
        legacyPrestige: house?.legacyPrestige ?? 0,
      }
    })
    .sort((a, b) => {
      if (b.provinceCount !== a.provinceCount) return b.provinceCount - a.provinceCount
      if (b.devSum !== a.devSum) return b.devSum - a.devSum
      if (b.legacyPrestige !== a.legacyPrestige) return b.legacyPrestige - a.legacyPrestige
      return a.houseId.localeCompare(b.houseId)
    })
  return ranked[0]?.houseId
}

function emitPolityExtinct(ctx: TickContext, polityId: PolityId, summary: string): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'POLITY_EXTINCT',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: [],
    summary,
    reasons: [],
    effects: [],
  }
  return { ...c1, events: [...c1.events, event] }
}

function emitPolityLandless(ctx: TickContext, polityId: PolityId, summary: string): TickContext {
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'POLITY_LANDLESS',
    importance: 'major',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: [],
    summary,
    reasons: [],
    effects: [],
  }
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
  const polityName = polity?.name ?? polityId
  const newHouseName = newHouse?.name ?? newOwnerId
  const capName = capProv?.name ?? newCapitalProvinceId
  const summary = oldOwnerId
    ? `${polityName}'s ruling house changed to ${newHouseName}, and the capital moved to ${capName}.`
    : `${polityName}'s ruling house is now ${newHouseName}; capital set to ${capName}.`
  const { id: eventId, ctx: c1 } = makeEventId(ctx)
  const event: SimEvent = {
    id: eventId,
    year: c1.state.currentYear,
    month: c1.state.currentMonth,
    type: 'POLITY_OWNER_CHANGED',
    importance: 'major',
    actorIds: [],
    houseIds: oldOwnerId ? [oldOwnerId, newOwnerId] : [newOwnerId],
    polityIds: [polityId],
    provinceIds: [newCapitalProvinceId],
    summary,
    reasons: [],
    effects: [],
  }
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
      currentCtx = emitPolityLandless(
        currentCtx,
        polityId,
        `${polity.name} no longer holds any land.`,
      )
      currentCtx = deactivatePolityInline(currentCtx, polityId)
      currentCtx = emitPolityExtinct(
        currentCtx,
        polityId,
        `${polity.name} has dissolved without remaining provinces.`,
      )
      continue
    }

    const eligibleHouseIds = getPolityHouseIds(currentCtx.state, polityId)

    // Step 2: ownerHouseId が undefined の場合の補充
    if (polity.ownerHouseId === undefined) {
      if (eligibleHouseIds.length === 0) {
        currentCtx = deactivatePolityInline(currentCtx, polityId)
        currentCtx = emitPolityExtinct(
          currentCtx,
          polityId,
          `${polity.name} has dissolved without an owning house.`,
        )
        continue
      }
      const newOwnerId = chooseOwner(currentCtx, polityId, eligibleHouseIds)!
      const newCapital =
        getHouseSeatProvinceInPolity(currentCtx.state, newOwnerId, polityId) ?? provinceIds[0]!
      const updated = currentCtx.state.polities[polityId]
      if (!updated) continue
      currentCtx = {
        ...currentCtx,
        state: {
          ...currentCtx.state,
          polities: {
            ...currentCtx.state.polities,
            [polityId]: {
              ...updated,
              ownerHouseId: newOwnerId,
              capitalProvinceId: newCapital,
            },
          },
        },
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

    if (eligibleHouseIds.length === 0) {
      currentCtx = deactivatePolityInline(currentCtx, polityId)
      currentCtx = emitPolityExtinct(
        currentCtx,
        polityId,
        `${polity.name} has dissolved after losing its owning house.`,
      )
      continue
    }

    const oldOwnerId = polity.ownerHouseId
    const newOwnerId = chooseOwner(currentCtx, polityId, eligibleHouseIds)!
    const newCapital =
      getHouseSeatProvinceInPolity(currentCtx.state, newOwnerId, polityId) ?? provinceIds[0]!
    const updated = currentCtx.state.polities[polityId]
    if (!updated) continue
    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        polities: {
          ...currentCtx.state.polities,
          [polityId]: {
            ...updated,
            ownerHouseId: newOwnerId,
            capitalProvinceId: newCapital,
          },
        },
      },
    }
    currentCtx = replacePolityLeader(currentCtx, polityId, newOwnerId)
    currentCtx = emitPolityOwnerChanged(currentCtx, polityId, oldOwnerId, newOwnerId, newCapital)
  }

  return currentCtx
}
