import type { WorldState } from '../types/world'
import type { HoldingId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { PopType } from '../types/popGroup'
import type { MonthlyPopChangeSnapshot, PopChangeEntry } from '../types/popChange'
import { popGroupChangeKey } from '../types/popChange'

export { popGroupChangeKey }

// v0.59: 月次「人口変動」snapshot の構築補助。PopSystem が月初に reset 生成し、CrisisSystem /
//   PopMigrationSystem が in-place で累積する。詳細は types/popChange.ts を参照。

export function createMonthlyPopChangeSnapshot(week: number): MonthlyPopChangeSnapshot {
  return { week, byHolding: {}, byPopGroupKey: {} }
}

function ensureHolding(snapshot: MonthlyPopChangeSnapshot, holdingId: HoldingId): PopChangeEntry {
  const existing = snapshot.byHolding[holdingId]
  if (existing) return existing
  const created: PopChangeEntry = { natural: 0, migrationIn: 0, migrationOut: 0 }
  snapshot.byHolding[holdingId] = created
  return created
}

function ensurePopGroupKey(snapshot: MonthlyPopChangeSnapshot, key: string): PopChangeEntry {
  const existing = snapshot.byPopGroupKey[key]
  if (existing) return existing
  const created: PopChangeEntry = { natural: 0, migrationIn: 0, migrationOut: 0 }
  snapshot.byPopGroupKey[key] = created
  return created
}

// 自然増減 (出生・自然死・crisis 死) を累積。delta は正=増、負=減。
//   ws.monthlyPopChange が未生成 (最初の PopSystem 前) の場合は no-op。
export function accrueNaturalPopChangeMut(
  ws: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  popType: PopType,
  employed: boolean,
  delta: number,
): void {
  const snapshot = ws.monthlyPopChange
  if (!snapshot) return
  if (delta === 0) return
  ensureHolding(snapshot, holdingId).natural += delta
  ensurePopGroupKey(snapshot, popGroupChangeKey(holdingId, popClass, popType, employed)).natural +=
    delta
}

// 移住流出を source holding / source pop group key に累積 (amount は正)。
export function accrueMigrationOutPopChangeMut(
  ws: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  popType: PopType,
  employed: boolean,
  amount: number,
): void {
  const snapshot = ws.monthlyPopChange
  if (!snapshot) return
  if (amount === 0) return
  ensureHolding(snapshot, holdingId).migrationOut += amount
  ensurePopGroupKey(
    snapshot,
    popGroupChangeKey(holdingId, popClass, popType, employed),
  ).migrationOut += amount
}

// 移住流入を target holding / target pop group key に累積 (amount は正)。
export function accrueMigrationInPopChangeMut(
  ws: WorldState,
  holdingId: HoldingId,
  popClass: PopClass,
  popType: PopType,
  employed: boolean,
  amount: number,
): void {
  const snapshot = ws.monthlyPopChange
  if (!snapshot) return
  if (amount === 0) return
  ensureHolding(snapshot, holdingId).migrationIn += amount
  ensurePopGroupKey(
    snapshot,
    popGroupChangeKey(holdingId, popClass, popType, employed),
  ).migrationIn += amount
}
