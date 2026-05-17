import type { TickContext } from './context'
import type { ProvinceId } from '../types/ids'
import type { Province } from '../types/province'
import { clamp } from '../utils/math'
import {
  calcChancellorControlGrowthModifier,
  calcChancellorControlMaxBonus,
  calcHouseHeadControlGrowthModifier,
  calcHouseHeadControlMaxBonus,
} from '../selectors/personAbilityEffects'

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
  const { provinces, countries, houses } = ctx.state
  const config = ctx.config

  // v013-residual: simple-batch — BFS 距離計算と組み合わせた countryControl/houseControl 更新。mutation 化はオーバーキル
  const newProvinces: Record<ProvinceId, Province> = {}
  for (const id of Object.keys(provinces) as ProvinceId[]) {
    const prov = provinces[id]
    if (!prov) continue
    newProvinces[id] = { ...prov }
  }

  for (const countryId of Object.keys(countries) as Array<keyof typeof countries>) {
    const country = countries[countryId]
    if (!country || !country.active) continue

    const growthModifier = calcChancellorControlGrowthModifier(ctx.state, country.id, config)
    const maxControlBonus = calcChancellorControlMaxBonus(ctx.state, country.id, config)
    const effectiveGrowth = config.controlGrowthPerMonth * growthModifier

    const distMap = bfs(
      country.capitalProvinceId,
      provinces,
      (prov) => (prov as { countryId: string }).countryId === country.id,
    )

    for (const provinceId of Object.keys(provinces) as ProvinceId[]) {
      const province = provinces[provinceId]
      if (!province || province.countryId !== country.id) continue

      const newProvince = newProvinces[provinceId]!
      const current = newProvince.countryControl
      const dist = distMap.get(provinceId)

      if (dist !== undefined) {
        const baseMaxControl = clamp(
          100 - dist * config.controlMaxDistancePenalty,
          config.controlMaxMinimum,
          100,
        )
        const isCapital = provinceId === country.capitalProvinceId
        const maxControl = isCapital
          ? 100
          : clamp(baseMaxControl + maxControlBonus, config.controlAbilityMinimumFloor, 100)
        newProvince.countryControl = applyControl(current, maxControl, effectiveGrowth, config)
      } else {
        newProvince.countryControl = Math.max(0, current - config.disconnectedControlDecayPerMonth)
      }
    }
  }

  for (const houseId of Object.keys(houses) as Array<keyof typeof houses>) {
    const house = houses[houseId]
    if (!house || !house.active) continue

    const growthModifier = calcHouseHeadControlGrowthModifier(ctx.state, house, config)
    const maxControlBonus = calcHouseHeadControlMaxBonus(ctx.state, house, config)
    const effectiveGrowth = config.controlGrowthPerMonth * growthModifier

    const distMap = bfs(
      house.seatProvinceId,
      provinces,
      (prov) => (prov as { countryId: string }).countryId === house.countryId,
    )

    for (const provinceId of Object.keys(provinces) as ProvinceId[]) {
      const province = provinces[provinceId]
      if (!province || province.ownerHouseId !== house.id) continue

      const newProvince = newProvinces[provinceId]!
      const current = newProvince.houseControl
      const dist = distMap.get(provinceId)

      if (dist !== undefined) {
        const baseMaxControl = clamp(
          100 - dist * config.controlMaxDistancePenalty,
          config.controlMaxMinimum,
          100,
        )
        const isSeat = provinceId === house.seatProvinceId
        const maxControl = isSeat
          ? 100
          : clamp(baseMaxControl + maxControlBonus, config.controlAbilityMinimumFloor, 100)
        newProvince.houseControl = applyControl(current, maxControl, effectiveGrowth, config)
      } else {
        newProvince.houseControl = Math.max(0, current - config.disconnectedControlDecayPerMonth)
      }
    }
  }

  return { ...ctx, state: { ...ctx.state, provinces: newProvinces } }
}
