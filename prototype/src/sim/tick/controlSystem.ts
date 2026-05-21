import type { TickContext } from './context'
import type { ProvinceId, HoldingId } from '../types/ids'
import type { Holding } from '../types/landContract'
import { clamp } from '../utils/math'
import {
  calcChancellorControlGrowthModifier,
  calcChancellorControlMaxBonus,
} from '../selectors/personAbilityEffects'
import { getProvinceTerminalPolityId } from '../selectors/landContractSelectors'

function bfs(
  startId: ProvinceId,
  provinces: Record<ProvinceId, unknown>,
  allowed: (prov: unknown) => boolean,
): Map<ProvinceId, number> {
  const distMap = new Map<ProvinceId, number>()
  const startProv = provinces[startId]
  if (!startProv || !allowed(startProv)) {
    return distMap
  }
  distMap.set(startId, 0)
  const queue: ProvinceId[] = [startId]
  const visited = new Set<ProvinceId>()
  visited.add(startId)

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const currentProv = provinces[currentId] as { neighbors: ProvinceId[] }
    const currentDist = distMap.get(currentId)!
    for (const neighborId of currentProv.neighbors) {
      if (visited.has(neighborId)) continue
      const neighborProv = provinces[neighborId]
      if (!neighborProv || !allowed(neighborProv)) continue
      visited.add(neighborId)
      distMap.set(neighborId, currentDist + 1)
      queue.push(neighborId)
    }
  }

  return distMap
}

function applyControl(
  current: number,
  maxControl: number,
  effectiveGrowth: number,
  config: { controlDecayPerMonth: number },
): number {
  if (current < maxControl) {
    return Math.min(current + effectiveGrowth, maxControl)
  }
  if (current > maxControl) {
    return Math.max(current - config.controlDecayPerMonth, maxControl)
  }
  return maxControl
}

export function runControlSystem(ctx: TickContext): TickContext {
  const { provinces, polities, holdings } = ctx.state
  const config = ctx.config

  const newHoldings: Record<HoldingId, Holding> = {}
  for (const id of Object.keys(holdings) as HoldingId[]) {
    const h = holdings[id]
    if (!h) continue
    newHoldings[id] = { ...h }
  }

  for (const polityId of Object.keys(polities) as Array<keyof typeof polities>) {
    const polity = polities[polityId]
    if (!polity || !polity.active) continue

    const growthModifier = calcChancellorControlGrowthModifier(ctx.state, polity.id, config)
    const maxControlBonus = calcChancellorControlMaxBonus(ctx.state, polity.id, config)
    const effectiveGrowth = config.controlGrowthPerMonth * growthModifier

    const distMap = bfs(polity.capitalProvinceId, provinces, () => true)

    for (const provinceId of Object.keys(provinces) as ProvinceId[]) {
      const province = provinces[provinceId]
      if (!province) continue
      if (getProvinceTerminalPolityId(ctx.state, provinceId) !== polity.id) continue

      const dist = distMap.get(provinceId)

      for (const holdingId of province.holdingIds) {
        const holding = newHoldings[holdingId]
        if (!holding) continue
        const current = holding.polityControl

        let newControl: number
        if (dist !== undefined) {
          const baseMaxControl = clamp(
            100 - dist * config.controlMaxDistancePenalty,
            config.controlMaxMinimum,
            100,
          )
          const isCapital = provinceId === polity.capitalProvinceId
          const maxControl = isCapital
            ? 100
            : clamp(baseMaxControl + maxControlBonus, config.controlAbilityMinimumFloor, 100)
          newControl = applyControl(current, maxControl, effectiveGrowth, config)
        } else {
          newControl = Math.max(0, current - config.disconnectedControlDecayPerMonth)
        }
        holding.polityControl = newControl
      }
    }
  }

  return { ...ctx, state: { ...ctx.state, holdings: newHoldings } }
}
