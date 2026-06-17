// v0.36: Battle entity の生成・index 管理。byWar index は空配列 delete purge。

import type { WorldState } from '../types/world'
import type {
  Battle,
  BattleRegimentResult,
  BattleOutcomeQuality,
  BattleTickUnit,
  BattleCommanderAssignment,
} from '../types/battle'
import type { RegimentId, WarId, ProvinceId, HoldingId } from '../types/ids'
import type { BattlefieldKind, BattleResult, BattleInitiationKind, WarSideKey } from '../types/war'
import { createBattleId } from '../types/ids'

// --- index ---

function addBattleToIndexMut(ws: WorldState, battle: Battle): void {
  ws.battleIndex.byWar[battle.warId] = [...(ws.battleIndex.byWar[battle.warId] ?? []), battle.id]
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
  // v0.37 Battlefront: internal sim の summary。Phase A では呼び出し側が渡さない (受け口のみ)。
  outcomeQuality?: BattleOutcomeQuality
  frontage?: number
  tickUnit?: BattleTickUnit
  maxTicks?: number
  ticksElapsed?: number
  attackerInitialFrontlineIds?: RegimentId[]
  defenderInitialFrontlineIds?: RegimentId[]
  attackerRoutedRegimentIds?: RegimentId[]
  defenderRoutedRegimentIds?: RegimentId[]
  breakthroughSide?: WarSideKey
  pursuitOccurred?: boolean
  attackerCommanderAssignments?: BattleCommanderAssignment[]
  defenderCommanderAssignments?: BattleCommanderAssignment[]
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
    // v0.37 Battlefront: optional summary。undefined のキーは exactOptionalPropertyTypes 準拠で省略する。
    ...(input.outcomeQuality !== undefined ? { outcomeQuality: input.outcomeQuality } : {}),
    ...(input.frontage !== undefined ? { frontage: input.frontage } : {}),
    ...(input.tickUnit !== undefined ? { tickUnit: input.tickUnit } : {}),
    ...(input.maxTicks !== undefined ? { maxTicks: input.maxTicks } : {}),
    ...(input.ticksElapsed !== undefined ? { ticksElapsed: input.ticksElapsed } : {}),
    ...(input.attackerInitialFrontlineIds !== undefined
      ? { attackerInitialFrontlineIds: input.attackerInitialFrontlineIds }
      : {}),
    ...(input.defenderInitialFrontlineIds !== undefined
      ? { defenderInitialFrontlineIds: input.defenderInitialFrontlineIds }
      : {}),
    ...(input.attackerRoutedRegimentIds !== undefined
      ? { attackerRoutedRegimentIds: input.attackerRoutedRegimentIds }
      : {}),
    ...(input.defenderRoutedRegimentIds !== undefined
      ? { defenderRoutedRegimentIds: input.defenderRoutedRegimentIds }
      : {}),
    ...(input.breakthroughSide !== undefined ? { breakthroughSide: input.breakthroughSide } : {}),
    ...(input.pursuitOccurred !== undefined ? { pursuitOccurred: input.pursuitOccurred } : {}),
    ...(input.attackerCommanderAssignments !== undefined
      ? { attackerCommanderAssignments: input.attackerCommanderAssignments }
      : {}),
    ...(input.defenderCommanderAssignments !== undefined
      ? { defenderCommanderAssignments: input.defenderCommanderAssignments }
      : {}),
  }
  ws.battles[id] = battle
  ws.nextBattleId++
  addBattleToIndexMut(ws, battle)
  return battle
}
