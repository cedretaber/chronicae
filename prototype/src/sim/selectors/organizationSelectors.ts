import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, PersonId, PolityId, HouseId, MerchantCompanyId } from '../types/ids'
import type { OrganizationRef } from '../types/office'
import { getPolityLeader, getHouseLeader } from './officeSelectors'
import { calcPolityMilitaryPower, calcHouseMilitaryPower } from './militarySelectors'
import {
  getPolityTerminalProvinceIds,
  getHouseControlledProvinceIds,
} from './landContractSelectors'
import { getPolityNameRefForEmit } from './nameRefSelectors'
import { getMerchantCompanyDecisionMaker } from './merchantSelectors'

// OrganizationRef.kind (polity / house) に対する分岐を 1 箇所に集約するための utility selector。
// v0.18/v0.34 で war/diplomacy の「主体 (actor)」分岐集約として導入したが、実体は組織 (polity /
// house) 多態の共有 helper であり office など他ドメインからも再利用する (旧名 actorSelectors)。
// 戦争・外交では実動の Intent 生成・DiplomaticPlay initiator として有効なのは polity のみ (spec §8.7)
// だが、selector レベルでは house も同等に扱える。

export function getOrganizationName(state: WorldState, actor: OrganizationRef): string {
  switch (actor.kind) {
    case 'polity':
      if (!state.polities[actor.id]) return 'Unknown Polity'
      return getPolityNameRefForEmit(state, actor.id).nameKey
    case 'house':
      return state.houses[actor.id]?.nameKey ?? 'Unknown House'
    case 'merchant_company':
      return state.merchantCompanies[actor.id]?.nameKey ?? 'Unknown Company'
    default: {
      const _exhaustive: never = actor
      throw new Error(`getOrganizationName: unexpected organization ${String(_exhaustive)}`)
    }
  }
}

export function getOrganizationLeaderPersonId(
  state: WorldState,
  actor: OrganizationRef,
): PersonId | undefined {
  switch (actor.kind) {
    case 'polity':
      return getPolityLeader(state, actor.id)
    case 'house':
      return getHouseLeader(state, actor.id)
    case 'merchant_company':
      return getMerchantCompanyDecisionMaker(state, actor.id)
    default: {
      const _exhaustive: never = actor
      throw new Error(
        `getOrganizationLeaderPersonId: unexpected organization ${String(_exhaustive)}`,
      )
    }
  }
}

export function getOrganizationMilitaryPower(
  state: WorldState,
  config: SimulationConfig,
  actor: OrganizationRef,
): number {
  switch (actor.kind) {
    case 'polity':
      return calcPolityMilitaryPower(state, config, actor.id)
    case 'house':
      return calcHouseMilitaryPower(state, config, actor.id)
    case 'merchant_company':
      // v0.61 商会は私兵を持たない (商会私兵は future)。
      return 0
    default: {
      const _exhaustive: never = actor
      throw new Error(
        `getOrganizationMilitaryPower: unexpected organization ${String(_exhaustive)}`,
      )
    }
  }
}

export function getOrganizationResourceAmount(state: WorldState, actor: OrganizationRef): number {
  switch (actor.kind) {
    case 'polity':
      return state.polities[actor.id]?.treasury ?? 0
    case 'house':
      return state.houses[actor.id]?.wealth ?? 0
    case 'merchant_company':
      return state.merchantCompanies[actor.id]?.treasury ?? 0
    default: {
      const _exhaustive: never = actor
      throw new Error(
        `getOrganizationResourceAmount: unexpected organization ${String(_exhaustive)}`,
      )
    }
  }
}

// Polity: terminal grantee Province を返す
// House: 当 House が控除権 (controlled) を持つ Province を返す
// merchant_company: v0.61 では領域を持たない (空)。
export function getOrganizationRelevantProvinceIds(
  state: WorldState,
  actor: OrganizationRef,
): ProvinceId[] {
  switch (actor.kind) {
    case 'polity':
      return getPolityTerminalProvinceIds(state, actor.id)
    case 'house':
      return getHouseControlledProvinceIds(state, actor.id)
    case 'merchant_company':
      return []
    default: {
      const _exhaustive: never = actor
      throw new Error(
        `getOrganizationRelevantProvinceIds: unexpected organization ${String(_exhaustive)}`,
      )
    }
  }
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
  switch (actor.kind) {
    case 'polity': {
      const p = state.polities[actor.id]
      return Boolean(p && p.active)
    }
    case 'house': {
      const h = state.houses[actor.id]
      return Boolean(h && h.active)
    }
    case 'merchant_company':
      return state.merchantCompanies[actor.id]?.status === 'active'
    default: {
      const _exhaustive: never = actor
      throw new Error(`isOrganizationActive: unexpected organization ${String(_exhaustive)}`)
    }
  }
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

export function merchantCompanyOrganization(id: MerchantCompanyId): OrganizationRef {
  return { kind: 'merchant_company', id }
}
