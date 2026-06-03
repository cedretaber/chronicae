import type { WorldState } from '../types/world'
import type { SimulationConfig } from '../config/defaultConfig'
import type { ProvinceId, PersonId, PolityId, HouseId } from '../types/ids'
import type { PoliticalActorRef } from '../types/actor'
import { getPolityLeader, getHouseLeader } from './officeSelectors'
import { calcPolityMilitaryPower, calcHouseMilitaryPower } from './militarySelectors'
import {
  getPolityTerminalProvinceIds,
  getHouseControlledProvinceIds,
} from './landContractSelectors'

// v0.18 Stage A §7
// PoliticalActorRef.kind に対する分岐を 1 箇所に集約するための utility selector。
// v0.18 では `polity` actor のみが Intent 生成・DiplomaticPlay initiator として有効
// (spec §8.7) だが、selector レベルでは House actor も同等に扱える。
//
// `spendActorResource` / `addActorResource` は v0.13 mutation API 集約方針 (pure function)
// に従い WorldState を返す。

export function getActorName(state: WorldState, actor: PoliticalActorRef): string {
  if (actor.kind === 'polity') {
    return state.polities[actor.id]?.nameKey ?? 'Unknown Polity'
  }
  return state.houses[actor.id]?.nameKey ?? 'Unknown House'
}

export function getActorLeaderPersonId(
  state: WorldState,
  actor: PoliticalActorRef,
): PersonId | undefined {
  if (actor.kind === 'polity') {
    return getPolityLeader(state, actor.id)
  }
  return getHouseLeader(state, actor.id)
}

export function getActorMilitaryPower(
  state: WorldState,
  config: SimulationConfig,
  actor: PoliticalActorRef,
): number {
  if (actor.kind === 'polity') {
    return calcPolityMilitaryPower(state, config, actor.id)
  }
  return calcHouseMilitaryPower(state, config, actor.id)
}

export function getActorResourceAmount(state: WorldState, actor: PoliticalActorRef): number {
  if (actor.kind === 'polity') {
    return state.polities[actor.id]?.treasury ?? 0
  }
  return state.houses[actor.id]?.wealth ?? 0
}

// Polity: terminal grantee Province を返す
// House: 当 House が控除権 (controlled) を持つ Province を返す
export function getActorRelevantProvinceIds(
  state: WorldState,
  actor: PoliticalActorRef,
): ProvinceId[] {
  if (actor.kind === 'polity') {
    return getPolityTerminalProvinceIds(state, actor.id)
  }
  return getHouseControlledProvinceIds(state, actor.id)
}

// v0.34: PoliticalActorRef を index key 文字列に変換する共有 helper。
// 形式は既存 inline (`${ref.kind}:${ref.id}`、例 projectMutations.ts) と同一で、
// warIndex.byParticipant / IntegrityCheck §14.7 で使用する。
// 例: { kind:'polity', id:'p-1' } -> "polity:p-1" / { kind:'house', id:'h-1' } -> "house:h-1"
export function politicalActorKey(ref: PoliticalActorRef): string {
  return `${ref.kind}:${ref.id as string}`
}

// v0.34: actor (Polity / House) が存在し active かを判定する共有 helper。
// IntegrityCheck §14.4 の active-participant 要求と、War lifecycle system の dead-participant guard で使う。
export function isActorActive(state: WorldState, actor: PoliticalActorRef): boolean {
  if (actor.kind === 'polity') {
    const p = state.polities[actor.id]
    return Boolean(p && p.active)
  }
  const h = state.houses[actor.id]
  return Boolean(h && h.active)
}

// 同一 actor かを比較する helper (kind+id で一致)。
export function isSameActor(a: PoliticalActorRef, b: PoliticalActorRef): boolean {
  if (a.kind !== b.kind) return false
  // PolityId / HouseId はどちらも branded string なので as string で比較
  return (a.id as string) === (b.id as string)
}

// 補助: PolityId / HouseId を持つ ref を作る (型推論の便宜)
export function polityActor(id: PolityId): PoliticalActorRef {
  return { kind: 'polity', id }
}

export function houseActor(id: HouseId): PoliticalActorRef {
  return { kind: 'house', id }
}
