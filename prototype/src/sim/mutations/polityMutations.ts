import type { TickContext } from '../tick/context'
import { makePolityId } from '../tick/context'
import type { HouseId, PolityId, ProvinceId } from '../types/ids'
import type { Polity } from '../types/polity'
import type { WorldState } from '../types/world'
import type { StateResult, CtxResult } from './result'
import { ok, err } from './result'
import { clamp } from '../utils/math'
import { createOfficeAssignment } from './officeMutations'
import { getHouseLeader } from '../selectors/officeSelectors'
import { getPolityHouseIds } from '../selectors/polityRelations'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'

export type CreatePolityInput = {
  nameKey: string
  capitalProvinceId?: ProvinceId
  treasury?: number
  legacyPrestige?: number
  adminPower?: number
  ownerHouseId?: HouseId
}

// v0.47 §11.9: Polity の ownerHouseId を付け替える単一 helper。polity.ownerHouseId と
// polityIndex.byOwnerHouse を同時更新する (byOwnerHouse を直接触らないための正本)。
export function reassignPolityOwnershipMut(
  state: WorldState,
  polityId: PolityId,
  newOwnerHouseId: HouseId,
): WorldState {
  const polity = state.polities[polityId]
  if (!polity) return state
  const oldOwnerHouseId = polity.ownerHouseId

  const byOwnerHouse = { ...state.polityIndex.byOwnerHouse }
  if (oldOwnerHouseId !== undefined) {
    const oldSlot = byOwnerHouse[oldOwnerHouseId] ?? []
    byOwnerHouse[oldOwnerHouseId] = oldSlot.filter((p) => p !== polityId)
  }
  const newSlot = byOwnerHouse[newOwnerHouseId] ?? []
  if (!newSlot.includes(polityId)) byOwnerHouse[newOwnerHouseId] = [...newSlot, polityId]

  return {
    ...state,
    polities: { ...state.polities, [polityId]: { ...polity, ownerHouseId: newOwnerHouseId } },
    polityIndex: { byOwnerHouse },
  }
}

export function createPolity(
  ctx: TickContext,
  input: CreatePolityInput & { ownerHouseId: HouseId },
): CtxResult<{ polityId: PolityId }> {
  const { id: polityId, ctx: ctxWithId } = makePolityId(ctx)

  const newPolity: Polity = {
    id: polityId,
    nameSource: { kind: 'pool', nameKey: input.nameKey },
    treasury: input.treasury ?? 0,
    adminPower: input.adminPower ?? 0,
    legacyPrestige: input.legacyPrestige ?? 0,
    active: true,
    capitalProvinceId: input.capitalProvinceId ?? ('' as ProvinceId),
    rank: 2,
    ownerHouseId: input.ownerHouseId,
    origin: { kind: 'worldgen' as const },
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

export function createPolityFromHouse(
  state: WorldState,
  rebelHouseId: HouseId,
  newPolityId: PolityId,
  nameKey?: string,
): WorldState {
  const rebelHouse = state.houses[rebelHouseId]
  if (!rebelHouse) return state

  const oldPolityId = getHousePrimaryPolityId(state, rebelHouseId)
  if (!oldPolityId) return state

  const oldPolity = state.polities[oldPolityId]
  if (!oldPolity) return state

  const polityNameKey = nameKey ?? rebelHouse.nameKey + '領'

  const newPolity: Polity = {
    id: newPolityId,
    nameSource: { kind: 'pool', nameKey: polityNameKey },
    treasury: Math.floor(rebelHouse.wealth * 0.5),
    legacyPrestige: 20,
    adminPower: 0,
    active: true,
    capitalProvinceId: rebelHouse.seatProvinceId,
    rank: 2,
    ownerHouseId: rebelHouseId,
    origin: { kind: 'worldgen' as const },
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
