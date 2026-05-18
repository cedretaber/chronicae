import type { ProvinceId, HouseId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'
import { clamp } from '../utils/math'
import { getHousePrimaryPolityId } from '../selectors/polityRelations'

export function transferProvinceToHouse(
  state: WorldState,
  provinceId: ProvinceId,
  newOwnerHouseId: HouseId,
  options?: { newHouseControl?: number },
): StateResult {
  const province = state.provinces[provinceId]
  if (!province)
    return err({ code: 'PROVINCE_NOT_FOUND', message: 'Province not found: ' + provinceId })

  const oldHouse = state.houses[province.ownerHouseId]
  if (!oldHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'Old owner house not found: ' + province.ownerHouseId,
    })

  const newOwnerHouse = state.houses[newOwnerHouseId]
  if (!newOwnerHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'New owner house not found: ' + newOwnerHouseId,
    })

  // v0.14 では province.countryId = newOwnerHouse.countryId だった。
  // v0.15 では House に polity 所属が無いため、(1) 既存所領から推定、(2) Polity.ownerHouseId 逆引き、
  // (3) どちらも該当なしなら province の元 polityId を維持、という順で決める。
  const inferredFromProvinces = getHousePrimaryPolityId(state, newOwnerHouseId)
  const inferredFromOwnership = inferredFromProvinces
    ? undefined
    : Object.values(state.polities).find((p) => p && p.active && p.ownerHouseId === newOwnerHouseId)
        ?.id
  const newProvincePolityId = inferredFromProvinces ?? inferredFromOwnership ?? province.polityId

  const newProvinces = { ...state.provinces }
  newProvinces[provinceId] = {
    ...province,
    ownerHouseId: newOwnerHouseId,
    polityId: newProvincePolityId,
    ...(options?.newHouseControl !== undefined
      ? { houseControl: options.newHouseControl }
      : undefined),
  }

  const newHouses = { ...state.houses }
  const newOldHouseProvinceIds = oldHouse.provinceIds.filter((id) => id !== provinceId)
  const newSeatProvinceId =
    oldHouse.seatProvinceId === provinceId
      ? (newOldHouseProvinceIds[0] ?? ('' as ProvinceId))
      : oldHouse.seatProvinceId
  newHouses[oldHouse.id] = {
    ...oldHouse,
    provinceIds: newOldHouseProvinceIds,
    seatProvinceId: newSeatProvinceId,
  }
  newHouses[newOwnerHouse.id] = {
    ...newOwnerHouse,
    provinceIds: [...newOwnerHouse.provinceIds, provinceId],
  }

  return ok({
    ...state,
    provinces: newProvinces,
    houses: newHouses,
  })
}

export function adjustProvinceDevelopment(
  state: WorldState,
  provinceId: ProvinceId,
  delta: number,
  options?: { min?: number; max?: number },
): StateResult {
  const province = state.provinces[provinceId]
  if (!province)
    return err({ code: 'PROVINCE_NOT_FOUND', message: 'Province not found: ' + provinceId })

  const min = options?.min ?? -100
  const max = options?.max ?? 100

  return ok({
    ...state,
    provinces: {
      ...state.provinces,
      [provinceId]: {
        ...province,
        development: clamp(province.development + delta, min, max),
      },
    },
  })
}

export function transferProvinceToPolity(
  state: WorldState,
  provinceId: ProvinceId,
  toPolityId: PolityId,
  toOwnerHouseId: HouseId,
): StateResult {
  if (!state.provinces[provinceId])
    return err({ code: 'PROVINCE_NOT_FOUND', message: 'Province not found: ' + provinceId })

  if (!state.polities[toPolityId])
    return err({ code: 'POLITY_NOT_FOUND', message: 'Target polity not found: ' + toPolityId })

  const toHouse = state.houses[toOwnerHouseId]
  if (!toHouse)
    return err({ code: 'HOUSE_NOT_FOUND', message: 'Target house not found: ' + toOwnerHouseId })

  // 受け手 House が対象 Polity に属することを検査:
  // (a) 既に対象 Polity 内に Province を持つ、または
  // (b) その Polity の ownerHouseId である（v0.15 §10.1 / §13.2 transient state 許容）
  const toOwnerPrimaryPolityId = getHousePrimaryPolityId(state, toOwnerHouseId)
  const targetPolity = state.polities[toPolityId]
  const isOwnerHouse =
    targetPolity?.active === true &&
    targetPolity.ownerHouseId !== undefined &&
    toOwnerHouseId === targetPolity.ownerHouseId
  if (toOwnerPrimaryPolityId && toOwnerPrimaryPolityId !== toPolityId && !isOwnerHouse)
    return err({
      code: 'CROSS_POLITY_TRANSFER',
      message: `House ${toOwnerHouseId} does not belong to polity ${toPolityId}`,
    })

  // transferProvinceToHouse に bookkeeping を委譲し、その後 polityId を toPolityId に強制する。
  // 委譲することで house.provinceIds の add/remove が正しく行われる（v0.14 と同じ責務分担）。
  const transferred = transferProvinceToHouse(state, provinceId, toOwnerHouseId)
  if (!transferred.ok) return transferred

  const transferredProvince = transferred.value.provinces[provinceId]
  if (!transferredProvince) return transferred

  return ok({
    ...transferred.value,
    provinces: {
      ...transferred.value.provinces,
      [provinceId]: { ...transferredProvince, polityId: toPolityId },
    },
  })
}
