import type { HoldingId } from './ids'
import type { PopClass, PopType } from './popGroup'
import type { WorkplaceRef } from './workplaceRef'
import { workplaceRefKey } from './workplaceRef'

// v0.59: 月次「人口変動」read-model。先月 (直近 4 週) の人口の純変動を、自然増減と移住に
//   分解して保持する。PopSystem が月初にリセット生成し自然増減を、CrisisSystem が飢饉・疫病・
//   戦災の死を自然減として、PopMigrationSystem が holding 間移住を、それぞれ in-place で累積する
//   (monthlyPopMobility と同じ latest-only / mutable-draft パターン)。
//
//   holding 合計の純変動 = natural + migrationIn − migrationOut で正確に一致する
//   (転職・雇用調整は holding 内で純ゼロ、epsilon 除去は <0.01 のノイズ)。
//   POP グループ単位では転職・雇用調整でも size が動くため、natural + migration は size の
//   素の差分とは一致しない (転職分は monthlyPopMobility.topMovements で別途保持)。

export type PopChangeEntry = {
  natural: number // 自然増減 (出生・自然死・飢饉/疫病/戦災死を含む)。正=増、負=減。
  migrationIn: number // holding への移住流入 (正)
  migrationOut: number // holding からの移住流出 (正)
}

export type MonthlyPopChangeSnapshot = {
  week: number
  byHolding: Record<HoldingId, PopChangeEntry>
  // key = popGroupChangeKey(...) (monthlyPopMobility / mergeCompatiblePopsMut と同一規約)
  byPopGroupKey: Record<string, PopChangeEntry>
}

// byPopGroupKey の合成キー。`${holdingId}|${class}|${popType}|${workplaceRefKey(employerId)}`。
export function popGroupChangeKey(
  holdingId: HoldingId,
  popClass: PopClass,
  popType: PopType,
  employerId: WorkplaceRef | null,
): string {
  return `${holdingId}|${popClass}|${popType}|${workplaceRefKey(employerId)}`
}
