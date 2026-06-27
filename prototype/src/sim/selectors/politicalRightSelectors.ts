// v0.42 PoliticalRight の read selector。index 経由の derivation のみ (entity 走査しない)。

import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { PolityId, RegimentId, HoldingId, HouseId, PoliticalRightId } from '../types/ids'
import type { OfficeRole } from '../types/office'
import { getEffectiveOfficeMaxHolders } from './officeSelectors'
import { getHouseProvinceIdsByPolity, getPolityProvinceIds } from './polityRelations'
import { getRegimentHoldingId } from '../mutations/regimentMutations'
import type {
  PoliticalRight,
  PoliticalRightHolderRef,
  PoliticalRightTargetRef,
} from '../types/politicalRight'
import { politicalRightTargetKey, politicalRightHolderKey } from '../types/politicalRight'

// v0.42 §13.3: right target から対象 polity を導出する。
// 影響力個人中心化 Phase 4: taskProjectCompletion から移設し export (継承判定と共有)。
export function getPolityIdForRightTarget(
  state: WorldState,
  target: PoliticalRightTargetRef,
): PolityId | undefined {
  switch (target.kind) {
    case 'polity_office_role':
      return target.polityId
    case 'holding_office_role':
      return state.holdingTerminalPolityCache[target.holdingId]
    case 'regiment': {
      const regiment = state.regiments[target.regimentId]
      return regiment && regiment.owner.kind === 'polity' ? regiment.owner.id : undefined
    }
  }
}

// target に対する active right (1 target 1 right — §4.2.2)。
export function getRightForTarget(
  state: WorldState,
  target: PoliticalRightTargetRef,
): PoliticalRight | undefined {
  const ids = state.politicalRightIndex.byTarget[politicalRightTargetKey(target)] ?? []
  const id = ids[0]
  return id !== undefined ? state.politicalRights[id] : undefined
}

// polity office role の特定 slot への appointment right (§9 / v0.42 slot 化)。
export function getPolityOfficeAppointmentRight(
  state: WorldState,
  polityId: PolityId,
  role: OfficeRole,
  slotIndex: number,
): PoliticalRight | undefined {
  return getRightForTarget(state, { kind: 'polity_office_role', polityId, role, slotIndex })
}

// holding bailiff への appointment right (§10)。
export function getHoldingOfficeAppointmentRight(
  state: WorldState,
  holdingId: HoldingId,
): PoliticalRight | undefined {
  return getRightForTarget(state, { kind: 'holding_office_role', holdingId, role: 'bailiff' })
}

// regiment の controller right (§11.2 — Regiment 型にフィールドは持たず index から導出)。
export function getRegimentControllerRight(
  state: WorldState,
  regimentId: RegimentId,
): PoliticalRight | undefined {
  return getRightForTarget(state, { kind: 'regiment', regimentId })
}

export function getRightsByHolder(
  state: WorldState,
  holder: PoliticalRightHolderRef,
): PoliticalRight[] {
  const ids = state.politicalRightIndex.byHolder[politicalRightHolderKey(holder)] ?? []
  return ids.flatMap((id: PoliticalRightId) => {
    const right = state.politicalRights[id]
    return right ? [right] : []
  })
}

// v0.42 §13.3: acquire_political_right の target 選定。
// kind 優先度: polity_office > holding_office > regiment。
//   - office: non-leader role を military > administrator > treasurer > advisor の順、
//     各 role 内は slot 0..effectiveMax-1 の若い順で、right 未設定の (role, slot)。
//     先頭 slot から確保するのは縮小時に「後ろから」失効するため (先頭ほど安全資産)
//   - holding: 対象 Polity が terminal の Holding (right 未設定)。owner House の関与 province の
//     Holding を優先し、それ以外は id 昇順 (spec「近い Holding を優先」の決定的な簡略化)
//   - regiment: 対象 Polity owner の active Regiment (right 未設定)。House 関与 province を
//     home とするものを優先し、それ以外は id 昇順
export function findAcquirableRightTarget(
  state: WorldState,
  config: SimulationConfig,
  houseId: HouseId,
  polityId: PolityId,
): PoliticalRightTargetRef | undefined {
  // 1. polity office role × slot
  const ROLE_PRIORITY: OfficeRole[] = ['military', 'administrator', 'treasurer', 'advisor']
  for (const role of ROLE_PRIORITY) {
    const effectiveMax = getEffectiveOfficeMaxHolders(
      state,
      config,
      { kind: 'polity', id: polityId },
      role,
    )
    for (let slotIndex = 0; slotIndex < effectiveMax; slotIndex++) {
      const target: PoliticalRightTargetRef = {
        kind: 'polity_office_role',
        polityId,
        role,
        slotIndex,
      }
      if (!getRightForTarget(state, target)) return target
    }
  }

  // 2. holding bailiff
  const houseProvinceIds = new Set<string>(getHouseProvinceIdsByPolity(state, houseId, polityId))
  const candidateHoldings: { holdingId: HoldingId; nearHouse: boolean }[] = []
  for (const provinceId of getPolityProvinceIds(state, polityId)) {
    const province = state.provinces[provinceId]
    if (!province) continue
    for (const holdingId of province.holdingIds) {
      if (state.holdingTerminalPolityCache[holdingId] !== polityId) continue
      const target: PoliticalRightTargetRef = {
        kind: 'holding_office_role',
        holdingId,
        role: 'bailiff',
      }
      if (getRightForTarget(state, target)) continue
      candidateHoldings.push({ holdingId, nearHouse: houseProvinceIds.has(provinceId) })
    }
  }
  candidateHoldings.sort((a, b) => {
    if (a.nearHouse !== b.nearHouse) return a.nearHouse ? -1 : 1
    return (a.holdingId as string).localeCompare(b.holdingId)
  })
  const holding = candidateHoldings[0]
  if (holding) {
    return { kind: 'holding_office_role', holdingId: holding.holdingId, role: 'bailiff' }
  }

  // 3. regiment
  const regimentIds = [...(state.regimentIndex.byOwner[`polity:${polityId}`] ?? [])]
  const candidateRegiments: { regimentId: RegimentId; nearHouse: boolean }[] = []
  for (const regimentId of regimentIds) {
    const regiment = state.regiments[regimentId]
    if (!regiment || regiment.status !== 'active') continue
    if (getRightForTarget(state, { kind: 'regiment', regimentId })) continue
    const regHoldingId = getRegimentHoldingId(state, regiment)
    const regHolding = regHoldingId !== undefined ? state.holdings[regHoldingId] : undefined
    const homeProvinceId = regHolding?.provinceId
    const nearHouse = homeProvinceId !== undefined && houseProvinceIds.has(homeProvinceId)
    candidateRegiments.push({ regimentId, nearHouse })
  }
  candidateRegiments.sort((a, b) => {
    if (a.nearHouse !== b.nearHouse) return a.nearHouse ? -1 : 1
    return (a.regimentId as string).localeCompare(b.regimentId)
  })
  const regiment = candidateRegiments[0]
  if (regiment) return { kind: 'regiment', regimentId: regiment.regimentId }

  return undefined
}

export function getRightsByPolity(state: WorldState, polityId: PolityId): PoliticalRight[] {
  const ids = state.politicalRightIndex.byPolity[polityId] ?? []
  return ids.flatMap((id: PoliticalRightId) => {
    const right = state.politicalRights[id]
    return right ? [right] : []
  })
}

// v0.51 陰謀リファイン §3.3: 任命権失効陰謀の target 選定。
// 同 Polity 内で「自家 (および自家メンバー person) 以外」の holder が持つ active right を 1 件選ぶ。
// person holder right を優先候補にする (家任命権は「最後の手段」= 高難度。§3.3 holder 種別 difficulty)。
// 同 holder 種別内は targetKey 昇順で決定的に選ぶ。失効対象が無ければ undefined (空回り排除)。
export function findRevocableRightTarget(
  state: WorldState,
  conspiringHouseId: HouseId,
  polityId: PolityId,
): PoliticalRightTargetRef | undefined {
  const house = state.houses[conspiringHouseId]
  const memberSet = new Set<string>(house ? house.memberIds.map((id) => id as string) : [])

  // 自家以外の holder が持つ right を person/house に分けて収集する。
  const personHeld: PoliticalRight[] = []
  const houseHeld: PoliticalRight[] = []
  for (const right of getRightsByPolity(state, polityId)) {
    if (right.holder.kind === 'house') {
      if (right.holder.id === conspiringHouseId) continue // 自家
      houseHeld.push(right)
    } else {
      if (memberSet.has(right.holder.id)) continue // 自家メンバー
      personHeld.push(right)
    }
  }

  const byTargetKey = (a: PoliticalRight, b: PoliticalRight): number =>
    politicalRightTargetKey(a.target).localeCompare(politicalRightTargetKey(b.target))

  // person holder right を優先 (低難度)、無ければ house holder right (高難度)。
  const pool = personHeld.length > 0 ? personHeld : houseHeld
  if (pool.length === 0) return undefined
  pool.sort(byTargetKey)
  return pool[0]!.target
}
