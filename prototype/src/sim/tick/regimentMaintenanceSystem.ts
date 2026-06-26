import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { RegimentId } from '../types/ids'
import {
  disbandRegimentMut,
  demobilizeRegimentMut,
  regimentOwnerSyncTarget,
  syncRegimentOwnerToHomeTerminalMut,
  getRegimentHoldingId,
} from '../mutations/regimentMutations'
import { isOrganizationActive } from '../selectors/organizationSelectors'

// v0.36 §14 RegimentMaintenanceSystem
//
// active Regiment の owner / home / war 参照を lazy に整理する。consistency 系 system の後・
// cleanupWarSystem の前に interval 1 で走る (§14.2 / §14.7)。
// soft reference (currentWarId / owner active / homeHolding 存在) は IntegrityCheck の hard invariant
// ではなく (§18.4)、本 system が遅延処理する。
//
// 処理順 (§14.6 注記を厳守):
//   1. homeHolding 消失 → disband (§14.5)
//   2. home terminal Polity が現 owner と異なる → owner 付け替え (§14.6。disband でなく)
//   3. (付け替え後の) owner inactive → disband (§14.4)
//   4. currentWarId が live(active) war を指していない → demobilize (§14.3)
// disband は war 参照解除を兼ねるため demobilize と二重処理しない。
//
// perf: active 以外は skip。変更が出るまで draft を clone しない (lazy clone)。
// 多くの週は land transfer / 滅亡 / 終戦が無く no-op で素通りする。

export function runRegimentMaintenanceSystem(ctx: TickContext): TickContext {
  const regimentIds = Object.keys(ctx.state.regiments)
  if (regimentIds.length === 0) return ctx

  let ws: WorldState = ctx.state
  let cloned = false
  const ensureDraft = (): void => {
    if (cloned) return
    ws = {
      ...ctx.state,
      regiments: { ...ctx.state.regiments },
      regimentIndex: {
        byOwner: { ...ctx.state.regimentIndex.byOwner },
        byWar: { ...ctx.state.regimentIndex.byWar },
      },
      regimentBarracks: { ...ctx.state.regimentBarracks },
      regimentBarracksIndex: {
        byHolding: { ...ctx.state.regimentBarracksIndex.byHolding },
        byRegiment: { ...ctx.state.regimentBarracksIndex.byRegiment },
      },
    }
    cloned = true
  }

  for (const idStr of regimentIds) {
    const rid = idStr as RegimentId
    const r0 = ws.regiments[rid]
    if (!r0 || r0.status !== 'active') continue

    // 1. homeHolding 消失 → disband (§14.5)
    const homeHoldingId = getRegimentHoldingId(ws, r0)
    if (homeHoldingId !== undefined && !ws.holdings[homeHoldingId]) {
      ensureDraft()
      disbandRegimentMut(ws, rid)
      continue
    }

    // 2. home terminal Polity 変化 → owner 付け替え (§14.6。basePower/strength/org/動員状態は維持)。
    //    判定・付け替え／disband 分岐は syncRegimentOwnerToHomeTerminalMut に集約 (叛乱奪取の
    //    eager 同期と共有・単一の真実)。ここでは lazy-clone gate にのみ純粋判定を使う。
    if (regimentOwnerSyncTarget(ws, r0) !== undefined) {
      ensureDraft()
      syncRegimentOwnerToHomeTerminalMut(ws, rid)
      // disbandAfterWar で disband された場合は下の再 read で status を見て continue する。
    }

    // 付け替えで owner が変わった可能性があるため再 read。
    const r = ws.regiments[rid]
    if (!r || r.status !== 'active') continue

    // 3. owner inactive → disband (§14.4)
    if (!isOrganizationActive(ws, r.owner)) {
      ensureDraft()
      disbandRegimentMut(ws, rid)
      continue
    }

    // 4. currentWarId が live(active) war を指していない → demobilize (§14.3)
    //    disbandAfterWar なら demobilize + disband
    if (r.currentWarId !== undefined) {
      const war = ws.wars[r.currentWarId]
      if (!war || war.status !== 'active') {
        ensureDraft()
        demobilizeRegimentMut(ws, rid)
        if (r.disbandAfterWar === true) {
          disbandRegimentMut(ws, rid)
        }
      }
    }
  }

  if (!cloned) return ctx
  return { ...ctx, state: ws }
}
