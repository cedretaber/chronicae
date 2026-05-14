import type { TickContext } from './context'
import type { ProvinceId } from '../types/ids'
import type { Province } from '../types/province'
import { clamp } from '../utils/math'

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
  distance: number,
  config: {
    controlMaxDistancePenalty: number
    controlMaxMinimum: number
    controlGrowthPerMonth: number
    controlDecayPerMonth: number
  },
): number {
  const maxControl = clamp(
    100 - distance * config.controlMaxDistancePenalty,
    config.controlMaxMinimum,
    100,
  )
  if (current < maxControl) {
    return Math.min(current + config.controlGrowthPerMonth, maxControl)
  }
  if (current > maxControl) {
    return Math.max(current - config.controlDecayPerMonth, maxControl)
  }
  return maxControl
}

export function runControlSystem(ctx: TickContext): TickContext {
  const { provinces, countries, houses } = ctx.state
  const config = ctx.config

  const newProvinces: Record<ProvinceId, Province> = {}
  for (const id of Object.keys(provinces) as ProvinceId[]) {
    const prov = provinces[id]
    if (!prov) continue
    newProvinces[id] = { ...prov }
  }

  for (const countryId of Object.keys(countries) as Array<keyof typeof countries>) {
    const country = countries[countryId]
    if (!country || !country.active) continue

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
        newProvince.countryControl = applyControl(current, dist, config)
      } else {
        newProvince.countryControl = Math.max(0, current - config.disconnectedControlDecayPerMonth)
      }
    }
  }

  for (const houseId of Object.keys(houses) as Array<keyof typeof houses>) {
    const house = houses[houseId]
    if (!house || !house.active) continue

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
        newProvince.houseControl = applyControl(current, dist, config)
      } else {
        newProvince.houseControl = Math.max(0, current - config.disconnectedControlDecayPerMonth)
      }
    }
  }

  return { ...ctx, state: { ...ctx.state, provinces: newProvinces } }
}
