import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, PersonId, PolityId, HouseId } from '../types/ids'
import type { OrganizationRef } from '../types/office'
import { getPolityLeader, getHouseLeader } from './officeSelectors'
import { calcPolityMilitaryPower, calcHouseMilitaryPower } from './militarySelectors'
import {
  getPolityTerminalProvinceIds,
  getHouseControlledProvinceIds,
} from './landContractSelectors'
import { getPolityNameRefForEmit } from './nameRefSelectors'

// OrganizationRef.kind (polity / house) に対する分岐を 1 箇所に集約するための utility selector。
// v0.18/v0.34 で war/diplomacy の「主体 (actor)」分岐集約として導入したが、実体は組織 (polity /
// house) 多態の共有 helper であり office など他ドメインからも再利用する (旧名 actorSelectors)。
// 戦争・外交では実動の Intent 生成・DiplomaticPlay initiator として有効なのは polity のみ (spec §8.7)
// だが、selector レベルでは house も同等に扱える。

export function getOrganizationName(state: WorldState, actor: OrganizationRef): string {
  if (actor.kind === 'polity') {
    if (!state.polities[actor.id]) return 'Unknown Polity'
    return getPolityNameRefForEmit(state, actor.id).nameKey
  }
  return state.houses[actor.id]?.nameKey ?? 'Unknown House'
}

export function getOrganizationLeaderPersonId(
  state: WorldState,
  actor: OrganizationRef,
): PersonId | undefined {
  if (actor.kind === 'polity') {
    return getPolityLeader(state, actor.id)
  }
  return getHouseLeader(state, actor.id)
}

export function getOrganizationMilitaryPower(
  state: WorldState,
  config: SimulationConfig,
  actor: OrganizationRef,
): number {
  if (actor.kind === 'polity') {
    return calcPolityMilitaryPower(state, config, actor.id)
  }
  return calcHouseMilitaryPower(state, config, actor.id)
}

export function getOrganizationResourceAmount(state: WorldState, actor: OrganizationRef): number {
  if (actor.kind === 'polity') {
    return state.polities[actor.id]?.treasury ?? 0
  }
  return state.houses[actor.id]?.wealth ?? 0
}

// Polity: terminal grantee Province を返す
// House: 当 House が控除権 (controlled) を持つ Province を返す
export function getOrganizationRelevantProvinceIds(
  state: WorldState,
  actor: OrganizationRef,
): ProvinceId[] {
  if (actor.kind === 'polity') {
    return getPolityTerminalProvinceIds(state, actor.id)
  }
  return getHouseControlledProvinceIds(state, actor.id)
}

// v0.34: OrganizationRef を index key 文字列に変換する共有 helper。
// 形式は既存 inline (`${ref.kind}:${ref.id}`、例 projectMutations.ts) と同一で、
// warIndex.byParticipant / IntegrityCheck §14.7 で使用する。
// 例: { kind:'polity', id:'p-1' } -> "polity:p-1" / { kind:'house', id:'h-1' } -> "house:h-1"
export function organizationKey(ref: OrganizationRef): string {
  return `${ref.kind}:${ref.id as string}`
}

// v0.34: organization (Polity / House) が存在し active かを判定する共有 helper。
// IntegrityCheck §14.4 の active-participant 要求と、War lifecycle system の dead-participant guard で使う。
export function isOrganizationActive(state: WorldState, actor: OrganizationRef): boolean {
  if (actor.kind === 'polity') {
    const p = state.polities[actor.id]
    return Boolean(p && p.active)
  }
  const h = state.houses[actor.id]
  return Boolean(h && h.active)
}

// 同一 organization かを比較する helper (kind+id で一致)。
export function isSameOrganization(a: OrganizationRef, b: OrganizationRef): boolean {
  if (a.kind !== b.kind) return false
  // PolityId / HouseId はどちらも branded string なので as string で比較
  return (a.id as string) === (b.id as string)
}

// 補助: PolityId / HouseId を持つ ref を作る (型推論の便宜)
export function polityOrganization(id: PolityId): OrganizationRef {
  return { kind: 'polity', id }
}

export function houseOrganization(id: HouseId): OrganizationRef {
  return { kind: 'house', id }
}
