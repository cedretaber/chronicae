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

// v0.18 Stage A §7
// 資源支出。actor が存在しない場合 / 残高不足の場合は支出せず state をそのまま返す。
// 残高不足を許容する場合は事前に getActorResourceAmount で確認すること。
export function spendActorResource(
  state: WorldState,
  actor: PoliticalActorRef,
  amount: number,
): WorldState {
  if (amount <= 0) return state
  if (actor.kind === 'polity') {
    const polity = state.polities[actor.id]
    if (!polity) return state
    if (polity.treasury < amount) return state
    return {
      ...state,
      polities: {
        ...state.polities,
        [actor.id]: { ...polity, treasury: polity.treasury - amount },
      },
    }
  }
  const house = state.houses[actor.id]
  if (!house) return state
  if (house.wealth < amount) return state
  return {
    ...state,
    houses: {
      ...state.houses,
      [actor.id]: { ...house, wealth: house.wealth - amount },
    },
  }
}

export function addActorResource(
  state: WorldState,
  actor: PoliticalActorRef,
  amount: number,
): WorldState {
  if (amount <= 0) return state
  if (actor.kind === 'polity') {
    const polity = state.polities[actor.id]
    if (!polity) return state
    return {
      ...state,
      polities: {
        ...state.polities,
        [actor.id]: { ...polity, treasury: polity.treasury + amount },
      },
    }
  }
  const house = state.houses[actor.id]
  if (!house) return state
  return {
    ...state,
    houses: {
      ...state.houses,
      [actor.id]: { ...house, wealth: house.wealth + amount },
    },
  }
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
