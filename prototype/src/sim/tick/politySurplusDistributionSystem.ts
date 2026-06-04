import type { TickContext } from './context'
import type { PolityId, HouseId } from '../types/ids'
import { getPolityInfluenceBreakdown } from '../selectors/influenceSelectors'
import { getPolityDistributablePerCycle } from '../selectors/landContractSelectors'

// v0.16 §18.2 / v0.42 §14: PolitySurplusDistributionSystem
// 給与控除後 (OfficeCompensation は別 system が treasury から引く) の余剰を分配する。
// distributable = max(0, treasury - reserveTarget) * distributionRate
// v0.42: share 比例 → Influence 比例。House entry にのみ分配し (entry.percent / 100)、
// Person entry (commonwealth leader 等) には分配しない。House entry が無い commonwealth
// では surplus を treasury に残す (§14.2)。
export function runPolitySurplusDistributionSystem(ctx: TickContext): TickContext {
  let state = ctx.state

  const houseWealthDeltas = new Map<HouseId, number>()
  const polityTreasuryDeltas = new Map<PolityId, number>()

  for (const polityIdStr of Object.keys(state.polities).sort()) {
    const polityId = polityIdStr as PolityId
    const polity = state.polities[polityId]
    if (!polity || !polity.active) continue

    // v0.37: reserveTarget+distributable は getPolityDistributablePerCycle に集約 (収入投影と共用)
    const distributable = getPolityDistributablePerCycle(state, polityId, ctx.config)
    if (distributable <= 0) continue

    const breakdown = getPolityInfluenceBreakdown(state, ctx.config, polityId)
    if (breakdown.totalScore <= 0) continue

    let actuallyDistributed = 0
    for (const entry of breakdown.entries) {
      if (entry.holder.kind !== 'house') continue
      const portion = (entry.percent / 100) * distributable
      if (portion <= 0) continue
      const house = state.houses[entry.holder.id]
      if (!house || !house.active) continue
      houseWealthDeltas.set(
        entry.holder.id,
        (houseWealthDeltas.get(entry.holder.id) ?? 0) + portion,
      )
      actuallyDistributed += portion
    }
    if (actuallyDistributed > 0) {
      polityTreasuryDeltas.set(polityId, -actuallyDistributed)
    }
  }

  if (houseWealthDeltas.size === 0 && polityTreasuryDeltas.size === 0) {
    return ctx
  }

  // 一括適用
  const newPolities = { ...state.polities }
  for (const [polityId, delta] of polityTreasuryDeltas) {
    const p = newPolities[polityId]
    if (!p) continue
    newPolities[polityId] = { ...p, treasury: Math.max(0, p.treasury + delta) }
  }

  const newHouses = { ...state.houses }
  for (const [houseId, delta] of houseWealthDeltas) {
    const h = newHouses[houseId]
    if (!h) continue
    newHouses[houseId] = { ...h, wealth: Math.max(0, h.wealth + delta) }
  }

  state = { ...state, polities: newPolities, houses: newHouses }
  return { ...ctx, state }
}
