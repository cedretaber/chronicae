// v0.36 §13 RegimentRecoverySystem
// Weekly organization recovery: base × (0.5 + morale/100), clamped 0..100.
// Strength and morale untouched (§13.4 / §5.7 morale is write-once placeholder).
// Tick interval: 1 (every week). Lazy clone-once for perf.

import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { RegimentId } from '../types/ids'
import { clamp } from '../utils/math'

export function runRegimentRecoverySystem(ctx: TickContext): TickContext {
  const regimentIds = Object.keys(ctx.state.regiments)
  if (regimentIds.length === 0) return ctx

  let ws: WorldState = ctx.state
  let cloned = false

  const ensureDraft = () => {
    if (!cloned) {
      ws = { ...ctx.state, regiments: { ...ctx.state.regiments } }
      cloned = true
    }
  }

  for (const idStr of regimentIds) {
    const rid = idStr as RegimentId
    const r = ws.regiments[rid]
    if (!r) continue

    if (r.status !== 'active' || r.organization >= 100) continue

    const moraleModifier = 0.5 + r.morale / 100
    const recovery = ctx.config.regimentOrganizationRecoveryPerWeek * moraleModifier
    const nextOrg = clamp(r.organization + recovery, 0, 100)

    ensureDraft()
    ws.regiments[rid] = { ...r, organization: nextOrg }
  }

  if (!cloned) return ctx
  return { ...ctx, state: ws }
}
