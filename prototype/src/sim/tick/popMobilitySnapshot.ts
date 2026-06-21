import type { StateRegionId } from '../types/ids'
import type { MonthlyPopMobilitySnapshot, PopMobilitySnapshotEntry } from '../types/popMobility'

// v0.56 §11: 月次 mobility snapshot の構築補助。PopJobChangeSystem が初期化し job entry を、
//   PopMigrationSystem が migration entry を追加して書き戻す (A3)。topMovements は bounded
//   top-N (各 system の top-N を merge しても global top-N は保たれる, §11.2)。

export function createMonthlyPopMobilitySnapshot(week: number): MonthlyPopMobilitySnapshot {
  return { week, jobChangedTotal: 0, migratedTotal: 0, byState: {}, topMovements: [] }
}

export function ensureByState(
  snapshot: MonthlyPopMobilitySnapshot,
  stateId: StateRegionId,
): { jobChanged: number; migratedIn: number; migratedOut: number } {
  const existing = snapshot.byState[stateId]
  if (existing) return existing
  const created = { jobChanged: 0, migratedIn: 0, migratedOut: 0 }
  snapshot.byState[stateId] = created
  return created
}

// §11.2 並び順: amount 降順 → kind → sourceHoldingId → targetHoldingId → fromPopType → toPopType。
function compareMovement(a: PopMobilitySnapshotEntry, b: PopMobilitySnapshotEntry): number {
  if (b.amount !== a.amount) return b.amount - a.amount
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
  const as = a.sourceHoldingId as string
  const bs = b.sourceHoldingId as string
  if (as !== bs) return as < bs ? -1 : 1
  const at = (a.targetHoldingId ?? '') as string
  const bt = (b.targetHoldingId ?? '') as string
  if (at !== bt) return at < bt ? -1 : 1
  if (a.fromPopType !== b.fromPopType) return a.fromPopType < b.fromPopType ? -1 : 1
  if (a.toPopType !== b.toPopType) return a.toPopType < b.toPopType ? -1 : 1
  return 0
}

export function mergeAndTruncateMovements(
  existing: PopMobilitySnapshotEntry[],
  incoming: PopMobilitySnapshotEntry[],
  limit: number,
): PopMobilitySnapshotEntry[] {
  const combined = [...existing, ...incoming]
  combined.sort(compareMovement)
  return combined.slice(0, Math.max(0, limit))
}
