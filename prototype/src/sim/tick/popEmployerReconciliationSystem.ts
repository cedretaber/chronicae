import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { WorkplaceRef } from '../types/workplaceRef'
import type { PopGroupId } from '../types/ids'
import { movePopEmploymentMut } from '../mutations/popMutations'

// v0.63: POP の employerId が指す entity が存在しない場合、unemployed に切り離す安全網。
//   per-site hook (facilityMaintenanceSystem の unbind 等) が主経路だが、
//   別経路で employer entity が消えた場合や hook が未実装のケースをカバーする。
//   "存在しない" = entity レコードが state に無い (inactive・zero-capacity は除外しない)。

function resolveWorkplaceRef(state: WorldState, ref: WorkplaceRef): boolean {
  switch (ref.kind) {
    case 'asset':
      return !!state.realEstateAssets[ref.id]
    case 'improvement':
      return !!state.holdingImprovements[ref.id]
    case 'merchant':
      return !!state.merchantCompanyEstablishments[ref.id]
    case 'barracks':
      return !!state.regimentBarracks[ref.id]
  }
}

export function runPopEmployerReconciliationSystem(ctx: TickContext): TickContext {
  // 走査前に snap して dangling を検出する。sort で採番決定性を保証 (§13-M_det)。
  const popIds = Object.keys(ctx.state.popGroups).sort() as PopGroupId[]

  // 事前スキャン: dangling があるかチェック (不要な draft clone を避けるため)。
  let hasDangling = false
  for (const pid of popIds) {
    const pop = ctx.state.popGroups[pid]
    if (!pop || pop.employerId === null) continue
    if (!resolveWorkplaceRef(ctx.state, pop.employerId)) {
      hasDangling = true
      break
    }
  }
  if (!hasDangling) return ctx

  // mutable draft (popGroups + popIndex が対象)。
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  for (const pid of popIds) {
    const pop = ws.popGroups[pid]
    if (!pop || pop.employerId === null) continue
    if (!resolveWorkplaceRef(ws, pop.employerId)) {
      // dangling: unemployed プールに移動 (merge-or-create は addToOrCreatePopGroupMut が担う)。
      movePopEmploymentMut(ws, { sourcePopId: pid, targetEmployerId: null, size: pop.size })
    }
  }

  return { ...ctx, state: ws }
}
