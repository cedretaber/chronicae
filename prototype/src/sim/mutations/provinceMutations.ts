import type { ProvinceId, HouseId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'
import { clamp } from '../utils/math'
import {
  getProvinceTerminalContract,
  getProvinceTerminalPolityId,
} from '../selectors/landContractSelectors'
import { transferLandContractGrantee } from './landContractMutations'

// v0.16: Province の直接所有は廃止された (§8)。所有変更は terminal LandContract の grantee 差し替えで表現する。
// この関数は v0.15 互換 API として残るが、内部で transferLandContractGrantee に委譲する。
// 「ownerHouseId 経由の Polity 推定」は不要になり、呼び出し側で toPolityId を明示すること (transferProvinceToPolity 参照)。
export function transferProvinceToHouse(
  state: WorldState,
  provinceId: ProvinceId,
  newOwnerHouseId: HouseId,
): StateResult {
  const province = state.provinces[provinceId]
  if (!province)
    return err({ code: 'PROVINCE_NOT_FOUND', message: 'Province not found: ' + provinceId })

  const newOwnerHouse = state.houses[newOwnerHouseId]
  if (!newOwnerHouse)
    return err({
      code: 'HOUSE_NOT_FOUND',
      message: 'New owner house not found: ' + newOwnerHouseId,
    })

  // 新 owner House が ownerHouseId である Polity を探し、terminal contract をその Polity に差し替える。
  const ownedPolityIds = state.polityIndex.byOwnerHouse[newOwnerHouseId] ?? []
  const targetPolityId = ownedPolityIds[0]
  if (!targetPolityId) {
    return err({
      code: 'NO_TARGET_POLITY',
      message: 'New owner house has no owned Polity: ' + newOwnerHouseId,
    })
  }

  const terminal = getProvinceTerminalContract(state, provinceId)
  if (!terminal)
    return err({
      code: 'NO_TERMINAL_CONTRACT',
      message: 'Province has no terminal LandContract: ' + provinceId,
    })

  return ok(transferLandContractGrantee(state, terminal.id, targetPolityId))
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

  // Read development from primary Holding (Province no longer stores development)
  const holdingId = province.holdingIds[0]
  const holding = holdingId ? state.holdings[holdingId] : undefined
  const currentDev = holding ? holding.development : 0
  const newDev = clamp(currentDev + delta, min, max)

  if (!holdingId || !holding) {
    return ok(state)
  }

  const nextState: WorldState = {
    ...state,
    holdings: {
      ...state.holdings,
      [holdingId]: { ...holding, development: newDev },
    },
  }
  return ok(nextState)
}

// v0.16: toOwnerHouseId は ownership chain の整合確認用 (toPolityId.ownerHouseId と一致するはず)。
export function transferProvinceToPolity(
  state: WorldState,
  provinceId: ProvinceId,
  toPolityId: PolityId,
  toOwnerHouseId: HouseId,
): StateResult {
  if (!state.provinces[provinceId])
    return err({ code: 'PROVINCE_NOT_FOUND', message: 'Province not found: ' + provinceId })

  const targetPolity = state.polities[toPolityId]
  if (!targetPolity)
    return err({ code: 'POLITY_NOT_FOUND', message: 'Target polity not found: ' + toPolityId })

  if (!state.houses[toOwnerHouseId])
    return err({ code: 'HOUSE_NOT_FOUND', message: 'Target house not found: ' + toOwnerHouseId })

  // Polity の ownerHouseId と引数の toOwnerHouseId が一致することを検査
  if (targetPolity.ownerHouseId !== undefined && targetPolity.ownerHouseId !== toOwnerHouseId) {
    return err({
      code: 'OWNER_MISMATCH',
      message: `Polity ${toPolityId} ownerHouseId (${targetPolity.ownerHouseId}) does not match requested toOwnerHouseId (${toOwnerHouseId})`,
    })
  }

  const currentTerminal = getProvinceTerminalPolityId(state, provinceId)
  if (currentTerminal === toPolityId) return ok(state)

  const terminal = getProvinceTerminalContract(state, provinceId)
  if (!terminal)
    return err({
      code: 'NO_TERMINAL_CONTRACT',
      message: 'Province has no terminal LandContract: ' + provinceId,
    })

  return ok(transferLandContractGrantee(state, terminal.id, toPolityId))
}
