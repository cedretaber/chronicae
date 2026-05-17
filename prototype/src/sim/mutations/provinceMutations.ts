import type { ProvinceId, HouseId, CountryId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'

export function transferProvinceToHouse(
  state: WorldState,
  provinceId: ProvinceId,
  newOwnerHouseId: HouseId,
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

  const newProvinces = { ...state.provinces }
  newProvinces[provinceId] = {
    ...province,
    ownerHouseId: newOwnerHouseId,
    countryId: newOwnerHouse.countryId,
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

export function transferProvinceToCountry(
  state: WorldState,
  provinceId: ProvinceId,
  toCountryId: CountryId,
  toOwnerHouseId: HouseId,
): StateResult {
  if (!state.provinces[provinceId])
    return err({ code: 'PROVINCE_NOT_FOUND', message: 'Province not found: ' + provinceId })

  if (!state.countries[toCountryId])
    return err({ code: 'COUNTRY_NOT_FOUND', message: 'Target country not found: ' + toCountryId })

  const toHouse = state.houses[toOwnerHouseId]
  if (!toHouse)
    return err({ code: 'HOUSE_NOT_FOUND', message: 'Target house not found: ' + toOwnerHouseId })

  if ((toHouse.countryId as string) !== (toCountryId as string))
    return err({
      code: 'CROSS_COUNTRY_TRANSFER',
      message: `House ${toOwnerHouseId} does not belong to country ${toCountryId}`,
    })

  return transferProvinceToHouse(state, provinceId, toOwnerHouseId)
}
