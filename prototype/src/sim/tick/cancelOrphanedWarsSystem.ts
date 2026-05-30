import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { WarId } from '../types/ids'
import { updateWar, getWarPrimaryAttacker, getWarPrimaryDefender } from '../mutations/warMutations'
import { isActorActive } from '../selectors/actorSelectors'
import { emitWarEnded } from './warEvents'

// v0.34 §7.9 cancelOrphanedWarsSystem【必須】
//
// 戦争は数年続くため、その間に participant polity/house が別要因 (属州独立・併合・revolt など) で
// missing/inactive になりうる。IntegrityCheck §14.4 は active War の participant が active であることを
// 要求するため、放置すると long-run で必ず違反 throw する。
//
// active War の primary participant が missing/inactive なら cancelled 化し WarGoal は実行しない。
//
// 配置 (§B advisor①): spec §10 の「Progress/Settlement の前」から変更し、
//   polityOwnerConsistencySystem / organizationConsistencySystem の後ろ・cleanupWarSystem の前に置く。
//   理由: PeaceSettlement が holding 移転で defender を landless 化 → 同 tick 後段の
//   polityOwnerConsistencySystem が extinct 化 → その polity が別 active War の participant の場合、
//   本 system が後段にいないと年末 integrity で throw する。warScore 計算の安全は
//   WarProgress/PeaceSettlement 冒頭の dead-participant guard が担保する。
//   取りこぼし防止のため 1w で走らせる (年末 integrity が必ず本 system 通過後になる)。

export function runCancelOrphanedWarsSystem(ctx: TickContext): TickContext {
  const absoluteWeek = ctx.state.absoluteWeek
  const activeWarIds = Object.keys(ctx.state.wars)
    .sort()
    .filter((id) => ctx.state.wars[id as WarId]?.status === 'active')
  if (activeWarIds.length === 0) return ctx

  const ws: WorldState = { ...ctx.state, wars: { ...ctx.state.wars } }
  const cancelled: WarId[] = []

  for (const idStr of activeWarIds) {
    const wid = idStr as WarId
    const war = ws.wars[wid]
    if (!war) continue
    const atk = getWarPrimaryAttacker(war)?.actor
    const def = getWarPrimaryDefender(war)?.actor
    const orphaned = !atk || !def || !isActorActive(ws, atk) || !isActorActive(ws, def)
    if (!orphaned) continue
    updateWar(ws, wid, { status: 'cancelled', endedWeek: absoluteWeek })
    cancelled.push(wid)
  }
  if (cancelled.length === 0) return ctx

  let next: TickContext = { ...ctx, state: ws }
  for (const wid of cancelled) {
    const w = next.state.wars[wid]
    if (w) next = emitWarEnded(next, w)
  }
  return next
}
