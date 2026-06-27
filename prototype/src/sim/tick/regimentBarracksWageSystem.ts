// v0.64 §8: RegimentBarracksWageSystem — monthly payroll for garrisoned POP.
//   Runs every 4 weeks (monthly). Sorts barracks IDs ascending for determinism.
//   For each active barracks:
//     - Skips if regiment is missing or disbanded.
//     - Non-polity owner → payrollFulfillment = 0, penalty applied.
//     - Polity owner → pays from treasury, distributes wages to POP, updates fulfillment.
//   Unpaid penalty scales with accumulated unpaidCount × shortfall.
//   Lazy clone-once (mutable draft) for performance.

import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { RegimentBarracksId, RegimentId, PopGroupId } from '../types/ids'
import { workplaceRefKey } from '../types/workplaceRef'

function applyUnpaidPenaltyMut(
  ws: WorldState,
  regimentId: RegimentId,
  payrollFulfillment: number,
  unpaidCount: number,
  config: TickContext['config'],
): void {
  const regiment = ws.regiments[regimentId]
  if (!regiment) return
  const shortfall = 1 - payrollFulfillment
  const multiplier = Math.max(1, unpaidCount)
  const organizationDamage = shortfall * config.barracksUnpaidOrganizationPenalty * multiplier
  const moraleDamage = shortfall * config.barracksUnpaidMoralePenalty * multiplier
  ws.regiments[regimentId] = {
    ...regiment,
    organization: Math.max(0, regiment.organization - organizationDamage),
    morale: Math.max(0, regiment.morale - moraleDamage),
  }
}

export function runRegimentBarracksWageSystem(ctx: TickContext): TickContext {
  const config = ctx.config
  const barracksIds = (Object.keys(ctx.state.regimentBarracks) as RegimentBarracksId[]).sort()

  if (barracksIds.length === 0) return ctx

  let ws: WorldState = ctx.state
  let cloned = false

  const ensureDraft = () => {
    if (!cloned) {
      ws = {
        ...ctx.state,
        regimentBarracks: { ...ctx.state.regimentBarracks },
        regiments: { ...ctx.state.regiments },
        polities: { ...ctx.state.polities },
        popGroups: { ...ctx.state.popGroups },
      }
      cloned = true
    }
  }

  for (const barracksId of barracksIds) {
    const barracks = ws.regimentBarracks[barracksId]
    if (!barracks || barracks.status !== 'active') continue

    const regiment = ws.regiments[barracks.regimentId]
    if (!regiment || regiment.status === 'disbanded') continue

    if (regiment.owner.kind !== 'polity') {
      ensureDraft()
      const currentBarracks = ws.regimentBarracks[barracksId]!
      const newUnpaidCount = currentBarracks.unpaidCount + 1
      ws.regimentBarracks[barracksId] = {
        ...currentBarracks,
        lastPayrollFulfillment: 0,
        unpaidCount: newUnpaidCount,
      }
      applyUnpaidPenaltyMut(ws, barracks.regimentId, 0, newUnpaidCount, config)
      continue
    }

    const polityId = regiment.owner.id
    const polity = ws.polities[polityId]
    if (!polity) continue

    // Gather POPs employed by this barracks within its holding
    const holdingPopIds = ws.popIndex.byHolding[barracks.holdingId] ?? []
    const barracksRefKey = workplaceRefKey({ kind: 'barracks', id: barracksId })

    let requiredPayroll = 0
    const popWageEntries: Array<{ id: PopGroupId; wage: number }> = []

    for (const popId of holdingPopIds) {
      const pop = ws.popGroups[popId]
      if (!pop) continue
      if (workplaceRefKey(pop.employerId) !== barracksRefKey) continue
      const wageRate = config.barracksMonthlyWageByPopType[pop.popType] ?? 0
      const wage = pop.size * wageRate
      requiredPayroll += wage
      popWageEntries.push({ id: popId, wage })
    }

    const paid = Math.min(requiredPayroll, Math.max(0, polity.treasury))
    const payrollFulfillment = requiredPayroll <= 0 ? 1 : paid / requiredPayroll

    ensureDraft()

    // Deduct from polity treasury
    ws.polities[polityId] = { ...ws.polities[polityId]!, treasury: polity.treasury - paid }

    // Distribute wages to POP proportional to wage weight
    if (paid > 0 && requiredPayroll > 0) {
      for (const { id: popId, wage } of popWageEntries) {
        const pop = ws.popGroups[popId]
        if (!pop) continue
        const popShare = (wage / requiredPayroll) * paid
        ws.popGroups[popId] = { ...pop, money: pop.money + popShare }
      }
    }

    // Update barracks fulfillment and unpaid counter
    const currentBarracks = ws.regimentBarracks[barracksId]!
    let newUnpaidCount: number
    if (payrollFulfillment < 1) {
      newUnpaidCount = currentBarracks.unpaidCount + 1
    } else {
      newUnpaidCount = Math.max(0, currentBarracks.unpaidCount - 1)
    }

    ws.regimentBarracks[barracksId] = {
      ...currentBarracks,
      lastPayrollFulfillment: payrollFulfillment,
      unpaidCount: newUnpaidCount,
    }

    // Apply penalty if underpaid
    if (payrollFulfillment < 1) {
      applyUnpaidPenaltyMut(ws, barracks.regimentId, payrollFulfillment, newUnpaidCount, config)
    }
  }

  if (!cloned) return ctx
  return { ...ctx, state: ws }
}
