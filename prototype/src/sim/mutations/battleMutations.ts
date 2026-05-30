// v0.36: Battle entity の生成・index 管理。byWar index は空配列 delete purge。

import type { WorldState } from '../types/world'
import type { Battle, BattleRegimentResult } from '../types/battle'
import type { RegimentId, WarId, ProvinceId, HoldingId } from '../types/ids'
import type { BattlefieldKind, BattleResult, BattleInitiationKind } from '../types/war'
import { createBattleId } from '../types/ids'

// --- index ---

export function addBattleToIndexMut(ws: WorldState, battle: Battle): void {
  ws.battleIndex.byWar[battle.warId] = [...(ws.battleIndex.byWar[battle.warId] ?? []), battle.id]
}

export function removeBattleFromIndexMut(ws: WorldState, battle: Battle): void {
  const ids = ws.battleIndex.byWar[battle.warId]
  if (!ids) {
    /* nothing */
  } else {
    const filtered = ids.filter((id) => (id as string) !== (battle.id as string))
    if (filtered.length > 0) {
      ws.battleIndex.byWar[battle.warId] = filtered
    } else {
      delete ws.battleIndex.byWar[battle.warId]
    }
  }
}

// --- creation ---

export type CreateBattleInput = {
  warId: WarId
  week: number
  provinceId: ProvinceId
  holdingId?: HoldingId
  battlefieldKind: BattlefieldKind
  initiationKind: BattleInitiationKind
  result: BattleResult
  attackerRegimentIds: RegimentId[]
  defenderRegimentIds: RegimentId[]
  regimentResults: BattleRegimentResult[]
  attackerBasePower: number
  defenderBasePower: number
  attackerEffectivePower: number
  defenderEffectivePower: number
  warScoreDelta: number
  warScoreAfter: number
}

export function createBattle(ws: WorldState, input: CreateBattleInput): Battle {
  const id = createBattleId(ws.nextBattleId)
  const battle: Battle = {
    id,
    warId: input.warId,
    week: input.week,
    provinceId: input.provinceId,
    ...(input.holdingId !== undefined ? { holdingId: input.holdingId } : {}),
    battlefieldKind: input.battlefieldKind,
    initiationKind: input.initiationKind,
    result: input.result,
    attackerRegimentIds: input.attackerRegimentIds,
    defenderRegimentIds: input.defenderRegimentIds,
    regimentResults: input.regimentResults,
    attackerBasePower: input.attackerBasePower,
    defenderBasePower: input.defenderBasePower,
    attackerEffectivePower: input.attackerEffectivePower,
    defenderEffectivePower: input.defenderEffectivePower,
    warScoreDelta: input.warScoreDelta,
    warScoreAfter: input.warScoreAfter,
  }
  ws.battles[id] = battle
  ws.nextBattleId++
  addBattleToIndexMut(ws, battle)
  return battle
}
