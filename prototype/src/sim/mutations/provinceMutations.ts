import type { ProvinceId, HouseId, PolityId } from '../types/ids'
import type { WorldState } from '../types/world'
import type { StateResult } from './result'
import { ok, err } from './result'
import { clamp } from '../utils/math'
import {
  getProvinceTerminalContract,
  getProvinceTerminalPolityId,
  getProvinceLandContractChain,
} from '../selectors/landContractSelectors'
import {
  transferLandContractGrantee,
  insertIntermediateLandContract,
  replaceLowerLandContract,
} from './landContractMutations'

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

// v0.16 §16.1: 戦争結果による Province の所有変更を case A/B/C で分岐する。
//   case A (attacker.rank == terminal.rank): terminal grantee swap (§12.1)
//   case B (attacker.rank <  terminal.rank): 上位 rank 勝者 — chain に既に居れば replaceLower、
//     居なければ insertIntermediate (§12.2 / §12.3)。chain 不変条件 7 を破る場合は skip。
//   case C (attacker.rank >  terminal.rank): 下位 rank 勝者 — terminal 変更不可、税率調整のみ (§12.4)。
//     v0.16 では暫定的に no-op (skip)。
//
// 戻り値は新 state または「変更なし state」。エラー時も state は不変。
export function transferProvinceByWarGoal(
  state: WorldState,
  provinceId: ProvinceId,
  attackerPolityId: PolityId,
): WorldState {
  const attackerPolity = state.polities[attackerPolityId]
  if (!attackerPolity) return state

  const terminal = getProvinceTerminalContract(state, provinceId)
  if (!terminal) return state

  if (terminal.granteePolityId === attackerPolityId) return state

  const terminalPolity = state.polities[terminal.granteePolityId]
  if (!terminalPolity) return state

  // Case A: 同 rank → terminal swap
  if (attackerPolity.rank === terminalPolity.rank) {
    return transferLandContractGrantee(state, terminal.id, attackerPolityId)
  }

  // Case B: attacker 上位 (rank 数値が小さい)
  if (attackerPolity.rank < terminalPolity.rank) {
    const chain = getProvinceLandContractChain(state, provinceId)
    const attackerInChain = chain.some((c) => c.granteePolityId === attackerPolityId)
    if (attackerInChain) {
      // chain 上に既に attacker がいる → 中間契約除去 (§12.3)
      return replaceLowerLandContract(state, { provinceId, winnerPolityId: attackerPolityId })
    }
    // attacker が chain に居ない → 中間挿入 (§12.2)
    const terminalIdx = chain.findIndex((c) => c.id === terminal.id)
    if (terminalIdx <= 0) {
      // chain depth 1 で挿入位置の親が root のみ。
      // root.rank=0 < attacker.rank < terminal.rank の条件は通常満たすが、
      // 結果として attacker が新たな root grantee になる構造は避ける。skip。
      return state
    }
    const parentContract = chain[terminalIdx - 1]!
    const parentPolity = state.polities[parentContract.granteePolityId]
    if (!parentPolity) return state
    // §7 不変条件 8: parent.rank < attacker.rank < terminal.rank を満たすか確認
    if (parentPolity.rank >= attackerPolity.rank) return state
    // attacker.rank < terminal.rank は case B 条件で確認済み
    const { state: newState } = insertIntermediateLandContract(state, {
      provinceId,
      belowContractId: terminal.id,
      newGranteePolityId: attackerPolityId,
      taxRateToGrantor: 0.3,
    })
    return newState
  }

  // Case C: attacker 下位 → terminal 変更不可、現状 no-op (§16.1)
  return state
}
