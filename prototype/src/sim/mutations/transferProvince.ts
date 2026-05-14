import type { ProvinceId, HouseId } from '../types/ids'
import type { WorldState } from '../types/world'

export function transferProvinceToHouse(
  state: WorldState,
  provinceId: ProvinceId,
  newOwnerHouseId: HouseId,
): WorldState {
  const province = state.provinces[provinceId]
  if (!province) throw new Error('Province not found')

  const oldHouse = state.houses[province.ownerHouseId]
  if (!oldHouse) throw new Error('Old owner house not found')

  const newOwnerHouse = state.houses[newOwnerHouseId]
  if (!newOwnerHouse) throw new Error('New owner house not found')

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

  return {
    ...state,
    provinces: newProvinces,
    houses: newHouses,
  }
}
