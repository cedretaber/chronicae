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
import type { RegimentId, WarId } from '../types/ids'
import type { SupplyShortageBand } from '../types/war'
import { computeShortageBand } from '../selectors/warSupplySelectors'
import { getRoleScore } from '../selectors/abilitySelectors'
import { clamp } from '../utils/math'

function computeWartimeRecoveryMultiplier(
  ws: WorldState,
  r: { currentWarId?: WarId; currentSide?: 'attacker' | 'defender' },
  config: TickContext['config'],
): number {
  if (r.currentWarId === undefined) return 1
  const war = ws.wars[r.currentWarId]
  if (!war || war.status !== 'active') return 1

  const side = r.currentSide === 'attacker' ? war.attacker : war.defender
  const supply = side.supplyState

  let band: SupplyShortageBand = 'none'
  if (supply) {
    band = computeShortageBand(supply.supplyPressure, config)
  }
  const supplyBandMult = config.warSupplyRecoveryMultiplierByBand[band]

  const cgId = side.captainGeneralPersonId
  const qmId = side.quartermasterPersonId
  const cgMitigation =
    cgId !== undefined
      ? (getRoleScore(ws, cgId, 'warCommand') / 100) *
        config.warSupplyCaptainGeneralMitigationFactor
      : 0
  const qmMitigation =
    qmId !== undefined
      ? (getRoleScore(ws, qmId, 'stewardship') / 100) *
        config.warSupplyQuartermasterMitigationFactor
      : 0
  const staffMitigation = Math.min(
    cgMitigation + qmMitigation,
    config.warSupplyMaxStaffRecoveryMitigation,
  )

  return config.wartimeRegimentRecoveryMultiplier * supplyBandMult * (1 + staffMitigation)
}

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

    const recoveryMult = computeWartimeRecoveryMultiplier(ws, r, config)
    const moraleAtTickStart = r.morale

    let nextOrg = r.organization
    if (r.organization < r.baselineOrganization) {
      const rawRecovery =
        config.regimentOrganizationRecoveryPerWeek * (0.5 + moraleAtTickStart / 100)
      nextOrg = Math.min(r.baselineOrganization, r.organization + rawRecovery * recoveryMult)
    } else if (r.organization > r.baselineOrganization) {
      nextOrg = Math.max(
        r.baselineOrganization,
        r.organization - config.regimentOrganizationDecayAboveBaselinePerWeek,
      )
    }
    nextOrg = clamp(nextOrg, 0, r.maxOrganization)

    let nextMorale = r.morale
    if (r.morale < r.baselineMorale) {
      nextMorale = Math.min(
        r.baselineMorale,
        r.morale + config.regimentMoraleRecoveryPerWeek * recoveryMult,
      )
    } else if (r.morale > r.baselineMorale) {
      nextMorale = Math.max(
        r.baselineMorale,
        r.morale - config.regimentMoraleDecayAboveBaselinePerWeek,
      )
    }
    nextMorale = clamp(nextMorale, 0, r.maxMorale)

    if (nextOrg === r.organization && nextMorale === r.morale) continue

    ensureDraft()
    ws.regiments[rid] = { ...r, organization: nextOrg, morale: nextMorale }
  }

  if (!cloned) return ctx
  return { ...ctx, state: ws }
}
