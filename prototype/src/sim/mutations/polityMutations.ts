import type { TickContext } from '../tick/context'
import { makePolityId } from '../tick/context'
import type { HouseId, PolityId, PersonId, ProvinceId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { Polity } from '../types/polity'
import type { WorldState } from '../types/world'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'
import { defaultConfig } from '../config/defaultConfig'
import { clamp } from '../utils/math'
import { createOfficeAssignment } from './officeMutations'
import { getPolityLeaderHouse, getHouseLeader } from '../selectors/officeSelectors'
import { generatePolityName } from '../selectors/polityNamingService'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'
import {
  getPolityTerminalProvinceIds,
  getHouseControlledProvinceIds,
} from '../selectors/landContractSelectors'
import { transferAllProvincesToPolity } from './landContractMutations'

export type CreatePolityInput = {
  name: string
  capitalProvinceId?: ProvinceId
  treasury?: number
  legacyPrestige?: number
  adminPower?: number
  ownerHouseId?: HouseId
}

export function createPolity(
  ctx: TickContext,
  input: CreatePolityInput & { ownerHouseId: HouseId },
): CtxResult<{ polityId: PolityId }> {
  const { id: polityId, ctx: ctxWithId } = makePolityId(ctx)

  const newPolity: Polity = {
    id: polityId,
    name: input.name,
    treasury: input.treasury ?? 0,
    adminPower: input.adminPower ?? 0,
    legacyPrestige: input.legacyPrestige ?? 0,
    active: true,
    capitalProvinceId: input.capitalProvinceId ?? ('' as ProvinceId),
    rank: 2,
    ownerHouseId: input.ownerHouseId,
  }

  const newState = {
    ...ctxWithId.state,
    polities: { ...ctxWithId.state.polities, [polityId]: newPolity },
  }
  return ok({ ctx: { ...ctxWithId, state: newState }, value: { polityId } })
}

export function deactivatePolity(
  state: WorldState,
  polityId: PolityId,
  options?: { deactivateHouses?: boolean },
): StateResult {
  const polity = state.polities[polityId]
  if (!polity)
    return err({
      code: 'POLITY_NOT_FOUND',
      message: 'deactivatePolity: polity not found: ' + polityId,
    })

  if (!polity.active) return ok(state)

  let newState = {
    ...state,
    polities: { ...state.polities, [polityId]: { ...polity, active: false } },
  }

  if (options?.deactivateHouses) {
    const newHouses = { ...newState.houses }
    for (const houseId of getPolityHouseIds(state, polityId)) {
      const house = newHouses[houseId]
      if (house && house.active) {
        newHouses[houseId] = { ...house, active: false }
      }
    }
    newState = { ...newState, houses: newHouses }
  }

  return ok(newState)
}

// TODO: Implement polity relocation logic for when houses need to move between polities
// Previously: moveHouseToCountry(state, houseId, newPolityId)
// A full implementation would update house.countryId, province.countryId, and person.countryId
// across the state, along with updating the source and target polity houseIds arrays.

export function annexPolity(
  state: WorldState,
  defeatedPolityId: PolityId,
  winnerPolityId: PolityId,
): WorldState {
  const defeatedPolity = state.polities[defeatedPolityId]
  if (!defeatedPolity) return state

  const winnerPolity = state.polities[winnerPolityId]
  if (!winnerPolity || !winnerPolity.active) return state

  // v0.16: 敗者 Polity が grantee である LandContract をすべて勝者 Polity に差し替える。
  // これにより敗者 Polity は landless となり、polityOwnerConsistencySystem が active=false 化する。
  let next = transferAllProvincesToPolity(state, defeatedPolityId, winnerPolityId)

  // 譲渡された Province の polityControl を低めにリセットする (新支配の浸透前)。
  const transferredProvinceIds = getPolityTerminalProvinceIds(next, winnerPolityId)
  const updatedProvinces = { ...next.provinces }
  for (const provinceId of transferredProvinceIds) {
    const province = updatedProvinces[provinceId]
    if (!province) continue
    if ((next.provinceTerminalPolityCache[provinceId] as string) !== (winnerPolityId as string))
      continue
    updatedProvinces[provinceId] = {
      ...province,
      polityControl: defaultConfig.annexedPolityControl,
    }
  }
  next = { ...next, provinces: updatedProvinces }

  // 敗者 Polity 自体を inactive に。consistency system が同じ判定をするが、明示しておく。
  next = {
    ...next,
    polities: {
      ...next.polities,
      [defeatedPolityId]: { ...defeatedPolity, active: false },
    },
  }
  return next
}

export function createPolityFromHouse(
  state: WorldState,
  rebelHouseId: HouseId,
  newPolityId: PolityId,
  name?: string,
): WorldState {
  const rebelHouse = state.houses[rebelHouseId]
  if (!rebelHouse) return state

  const oldPolityId = getHousePrimaryPolityId(state, rebelHouseId)
  if (!oldPolityId) return state

  const oldPolity = state.polities[oldPolityId]
  if (!oldPolity) return state

  const polityName = name ?? rebelHouse.name + '領'

  const newPolity: Polity = {
    id: newPolityId,
    name: polityName,
    treasury: Math.floor(rebelHouse.wealth * 0.5),
    legacyPrestige: 20,
    adminPower: 0,
    active: true,
    capitalProvinceId: rebelHouse.seatProvinceId,
    rank: 2,
    ownerHouseId: rebelHouseId,
  }

  const politiesWithNew = { ...state.polities, [newPolityId]: newPolity }
  const stateWithNew = { ...state, polities: politiesWithNew }

  const leaderId =
    getHouseLeader(stateWithNew, rebelHouseId) ??
    rebelHouse.memberIds.find((id) => {
      const p = stateWithNew.persons[id]
      return p && p.alive
    })
  const stateWithLeader: WorldState = leaderId
    ? createOfficeAssignment(stateWithNew, { kind: 'polity', id: newPolityId }, 'leader', leaderId)
    : stateWithNew

  const updatedOldPolity = stateWithLeader.polities[oldPolityId]
  if (!updatedOldPolity) return stateWithLeader

  const penalizedOldPolity = {
    ...updatedOldPolity,
    legacyPrestige: clamp(updatedOldPolity.legacyPrestige - 10, 0, 100),
    adminPower: clamp(updatedOldPolity.adminPower - 5, 0, 100),
  }

  // v0.16: capitalProvinceId は維持する。当該 Polity が現在 terminal holder でなくてもよい (§10.1)。
  const finalOldPolity: Polity = penalizedOldPolity

  const hasActiveHouses = true
  const resolvedOldPolity = hasActiveHouses ? finalOldPolity : { ...finalOldPolity, active: false }

  return {
    ...stateWithLeader,
    polities: {
      ...stateWithLeader.polities,
      [oldPolityId]: resolvedOldPolity,
    },
  }
}

export function createPolityFromProvinces(
  ctx: TickContext,
  params: {
    provinceIds: ProvinceId[]
    rulerHouseId: HouseId
    capitalProvinceId: ProvinceId
    sourcePolityId: PolityId
    founderPersonId?: PersonId
    rebelClass?: PopClass
  },
): { polity: Polity; ctx: TickContext } {
  const { id, ctx: ctx1 } = makePolityId(ctx)

  const { name, rng: rng1 } = generatePolityName(ctx1.state, ctx1.config, ctx1.rng, {
    origin: 'province_revolt_independence',
    capitalProvinceId: params.capitalProvinceId,
    rulingHouseId: params.rulerHouseId,
    sourcePolityId: params.sourcePolityId,
    ...(params.provinceIds !== undefined && { provinceIds: params.provinceIds }),
    ...(params.founderPersonId !== undefined && { founderPersonId: params.founderPersonId }),
    ...(params.rebelClass !== undefined && { rebelClass: params.rebelClass }),
  })
  const finalCtx = { ...ctx1, rng: rng1 }

  const polity: Polity = {
    id,
    name,
    treasury: finalCtx.config.revoltPolityInitialTreasury,
    legacyPrestige: finalCtx.config.revoltPolityInitialLegacyPrestige,
    adminPower: 0,
    active: true,
    capitalProvinceId: params.capitalProvinceId,
    rank: 2,
    ownerHouseId: params.rulerHouseId,
  }

  const stateWithPolity = {
    ...finalCtx.state,
    polities: { ...finalCtx.state.polities, [id]: polity },
  }

  const leaderPersonId = params.founderPersonId
  const stateWithLeader = leaderPersonId
    ? createOfficeAssignment(stateWithPolity, { kind: 'polity', id }, 'leader', leaderPersonId)
    : stateWithPolity

  return { polity, ctx: { ...finalCtx, state: stateWithLeader } }
}

export function moveHouseToPolity(
  state: WorldState,
  houseId: HouseId,
  newPolityId: PolityId,
): StateResult {
  const house = state.houses[houseId]
  if (!house)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'moveHouseToPolity: house not found: ' + houseId,
    })

  const oldPolityId = getHousePrimaryPolityId(state, houseId)
  if (!oldPolityId) return err({ code: 'POLITY_NOT_FOUND', message: 'House has no primary polity' })

  const oldPolity = state.polities[oldPolityId]
  const newPolity = state.polities[newPolityId]
  if (!oldPolity || !newPolity)
    return err({ code: 'POLITY_NOT_FOUND', message: 'Polity not found' })

  const newHouses = {
    ...state.houses,
    [houseId]: house,
  }

  const newPolities = {
    ...state.polities,
  }

  return ok({
    ...state,
    houses: newHouses,
    polities: newPolities,
  })
}
