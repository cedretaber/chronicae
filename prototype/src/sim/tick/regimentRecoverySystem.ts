// v0.37 §4 RegimentRecoverySystem (baseline-aware)
// Weekly recovery/decay of organization and morale toward each Regiment's baseline.
//   organization: < baseline → recover by recoveryPerWeek × (0.5 + moraleAtTickStart/100);
//                 > baseline → decay by decayAboveBaselinePerWeek. clamp 0..maxOrganization.
//   morale: independent of organization. < baseline → recover; > baseline → decay. clamp 0..maxMorale.
// organization recovery reads morale at tick start (§4.2), so morale recovery this tick does not
//   feed back into organization recovery the same week.
// Strength untouched. Tick interval: 1 (every week). Lazy clone-once for perf.

import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { RegimentId } from '../types/ids'
import { clamp } from '../utils/math'

export function runRegimentRecoverySystem(ctx: TickContext): TickContext {
  const regimentIds = Object.keys(ctx.state.regiments)
  if (regimentIds.length === 0) return ctx

  const config = ctx.config
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
    if (r.status !== 'active') continue

    // §4.2: organization recovery reads morale at tick start.
    const moraleAtTickStart = r.morale

    // §4.3: organization toward baselineOrganization.
    let nextOrg = r.organization
    if (r.organization < r.baselineOrganization) {
      nextOrg = Math.min(
        r.baselineOrganization,
        r.organization +
          config.regimentOrganizationRecoveryPerWeek * (0.5 + moraleAtTickStart / 100),
      )
    } else if (r.organization > r.baselineOrganization) {
      nextOrg = Math.max(
        r.baselineOrganization,
        r.organization - config.regimentOrganizationDecayAboveBaselinePerWeek,
      )
    }
    nextOrg = clamp(nextOrg, 0, r.maxOrganization)

    // §4.4: morale toward baselineMorale, independent of organization.
    let nextMorale = r.morale
    if (r.morale < r.baselineMorale) {
      nextMorale = Math.min(r.baselineMorale, r.morale + config.regimentMoraleRecoveryPerWeek)
    } else if (r.morale > r.baselineMorale) {
      nextMorale = Math.max(
        r.baselineMorale,
        r.morale - config.regimentMoraleDecayAboveBaselinePerWeek,
      )
    }
    nextMorale = clamp(nextMorale, 0, r.maxMorale)

    // No change (e.g. at rest at baseline) → keep lazy clone intact.
    if (nextOrg === r.organization && nextMorale === r.morale) continue

    ensureDraft()
    ws.regiments[rid] = { ...r, organization: nextOrg, morale: nextMorale }
  }

  if (!cloned) return ctx
  return { ...ctx, state: ws }
}
