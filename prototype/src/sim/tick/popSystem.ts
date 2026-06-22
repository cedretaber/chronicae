import { clamp } from '../utils/math'
import type { TickContext } from './context'
import type { WorldState } from '../types/world'
import type { PopGroupId, ProvinceId, HoldingId } from '../types/ids'
import {
  getProvincePopulationPressure,
  getHoldingEmployedPopSizeByType,
  getHoldingTotalPopSize,
} from '../selectors/popSelectors'
import { removePopGroupMut } from '../mutations/popMutations'

// v0.55 POP 再設計: 旧 minSize 底上げ (就業 POP を minPopSizeByClass へ無条件で水増し) は撤廃した。
//   雇用 capacity を持たない class (upper) を per-group に minSize へ底上げすると、その超過分が
//   employmentRebalanceSystem 経由で未就業へ流れ、未就業が無制限に蓄積する人口生成ポンプになっていた
//   (旧雇用システムの遺物バグ)。マルサス的モデルでは人口は食料 carrying capacity に縛られるため、
//   人為的な下限底上げは不要。normalizePopSizes は epsilon 以下の POP を除去するのみとする。
export function normalizePopSizes(ctx: TickContext): TickContext {
  const epsilon = ctx.config.popSizeEpsilon
  let changed = false

  for (const popGroupId of Object.keys(ctx.state.popGroups).sort()) {
    const pop = ctx.state.popGroups[popGroupId as PopGroupId]
    if (!pop) continue
    if (pop.size <= epsilon) {
      changed = true
      break
    }
  }

  if (!changed) return ctx

  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
  }

  const toRemove: PopGroupId[] = []
  for (const popGroupId of Object.keys(ws.popGroups).sort() as PopGroupId[]) {
    const pop = ws.popGroups[popGroupId]
    if (!pop) continue
    if (pop.size <= epsilon) toRemove.push(pop.id)
  }

  for (const popId of toRemove) {
    removePopGroupMut(ws, popId)
  }

  return { ...ctx, state: ws }
}

export function runPopSystem(ctx: TickContext): TickContext {
  const ws: WorldState = {
    ...ctx.state,
    popGroups: { ...ctx.state.popGroups },
    popIndex: { byHolding: { ...ctx.state.popIndex.byHolding } },
    nextPopGroupId: ctx.state.nextPopGroupId,
  }

  // Snapshot POP IDs before loop (決定論的反復順)。v0.55: overflow による新規 POP 生成は廃止。
  const popIdSnapshot = Object.keys(ws.popGroups).sort() as PopGroupId[]

  // Pre-compute pressure per province
  const pressureByProvince = new Map<string, number>()
  for (const provinceId of Object.keys(ws.provinces).sort()) {
    pressureByProvince.set(
      provinceId,
      getProvincePopulationPressure(ws, ctx.config, provinceId as ProvinceId),
    )
  }

  // v0.57 §雇用細分化: holding 単位の治安 unrest 低減を事前計算。
  //   治安力 = (employed soldiers + ministeriales) / total pop。兵士・家士が多いほど unrest を下げる。
  const securityUnrestReductionByHolding = new Map<string, number>()
  for (const holdingId of Object.keys(ws.holdings).sort()) {
    const hid = holdingId as HoldingId
    const total = getHoldingTotalPopSize(ws, hid)
    if (total <= 0) continue
    const securityPop =
      getHoldingEmployedPopSizeByType(ws, hid, 'soldiers') +
      getHoldingEmployedPopSizeByType(ws, hid, 'ministeriales')
    const coverage = securityPop / total
    const reduction =
      ctx.config.securityUnrestReductionAtFull *
      clamp(coverage / ctx.config.securityFullCoverageRatio, 0, 1)
    if (reduction > 0) securityUnrestReductionByHolding.set(holdingId, reduction)
  }

  for (const popGroupId of popIdSnapshot) {
    const pop = ws.popGroups[popGroupId]
    if (!pop) continue

    const holding = ws.holdings[pop.holdingId]
    if (!holding) continue

    const pressure = pressureByProvince.get(holding.provinceId) ?? 0

    // 1. Population growth
    const growthFactor = clamp(1 - pressure * pressure, -0.5, 1.0)
    const baseGrowth = ctx.config.baseMonthlyGrowthByClass[pop.class]
    const wealthFactor = clamp(0.5 + pop.wealth / 100, 0.5, 1.5)
    const unrestFactor = clamp(1 - pop.unrest / 150, 0.3, 1)

    const employmentGrowthModifier: number = pop.employed
      ? 1
      : ctx.config.unemployedGrowthModifierByClass[pop.class]

    const delta =
      pop.size * baseGrowth * growthFactor * wealthFactor * unrestFactor * employmentGrowthModifier

    // 2. Apply growth (v0.55 POP 再設計)
    //   成長は food carrying capacity の growthFactor (pressure) で頭打ちにする。
    //   旧「就業POPを職capacityへ近づけ超過分を新unemployedへ overflow」する人口=職スロット結合は
    //   除去 (旧雇用システムの遺物)。employed が職capacityを超えた分は直後の
    //   employmentRebalanceSystem (Phase1 強制失業) が派生処理する。
    let newSize: number
    if (delta <= 0) {
      newSize = Math.max(0, pop.size + delta)
    } else {
      newSize = pop.size + delta
    }

    // 3. Population pressure effect
    let newWealth = pop.wealth
    let newUnrest = pop.unrest

    if (pressure > ctx.config.populationPressureThreshold) {
      const excess = pressure - ctx.config.populationPressureThreshold
      newWealth = pop.wealth - excess * ctx.config.populationPressureWealthPenalty
      newUnrest = pop.unrest + excess * ctx.config.populationPressureUnrestGain
    }

    // 4. Poverty effect
    if (pop.wealth < ctx.config.povertyWealthThreshold) {
      newUnrest += (ctx.config.povertyWealthThreshold - pop.wealth) * ctx.config.povertyUnrestGain
    }

    // 5. Prosperity effect
    if (pop.wealth > ctx.config.prosperityWealthThreshold) {
      newUnrest -=
        (pop.wealth - ctx.config.prosperityWealthThreshold) * ctx.config.prosperityUnrestReduction
    }

    // 5.5. Natural unrest decay
    newUnrest *= 1 - ctx.config.unrestNaturalDecayRate

    // 5.6. v0.57 §雇用細分化: 治安 (兵士・家士) による unrest 低減。
    newUnrest -= securityUnrestReductionByHolding.get(pop.holdingId) ?? 0

    // 6. Unemployed POP penalties
    if (!pop.employed) {
      newWealth -= ctx.config.unemployedWealthDecayByClass[pop.class]
      newUnrest += ctx.config.unemployedUnrestGainByClass[pop.class]
    }

    // 7. Clamp (v0.55 POP 再設計: 就業 POP の minSize 底上げは撤廃。人口は food CC に縛られる)
    const finalSize = Math.max(0, newSize)
    const finalWealth = clamp(newWealth, 0, 100)
    const finalUnrest = clamp(newUnrest, 0, 100)

    ws.popGroups[pop.id] = {
      ...pop,
      size: finalSize,
      wealth: finalWealth,
      unrest: finalUnrest,
    }
  }

  return { ...ctx, state: ws }
}
