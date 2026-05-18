import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import { calcHouseHeadDevelopmentChanceBonus } from '../selectors/personAbilityEffects'
import type { HouseId, ProvinceId } from '../types/ids'
import type { Province } from '../types/province'
import type { SimEvent } from '../types/event'
import { getHouseControlledProvinceIds } from '../selectors/landContractSelectors'

function scoreHouseLandDevelopmentProvince(province: Province): number {
  const recoveryBonus = Math.max(0, -province.development) * 1.0
  const developmentPotentialBonus = (100 - Math.max(0, province.development)) * 0.3
  return recoveryBonus + developmentPotentialBonus
}

export function runHouseDevelopmentSystem(ctx: TickContext): TickContext {
  if (!ctx.config.houseDevelopmentEnabled) return ctx
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  for (const houseId of Object.keys(ctx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    const controlledProvinceIds = getHouseControlledProvinceIds(currentCtx.state, house.id)
    if (controlledProvinceIds.length === 0) continue

    const minWealth =
      currentCtx.config.houseLandDevelopmentBaseCost + currentCtx.config.houseWealthReserve
    if (house.wealth < minWealth) continue

    const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    const excessWealth = house.wealth - minWealth
    const baseChance = currentCtx.config.houseDevelopmentYearlyChance
    const wealthBonus = clamp(excessWealth / 300, 0, 0.25)
    const abilityChanceBonus = calcHouseHeadDevelopmentChanceBonus(
      currentCtx.state,
      house,
      currentCtx.config,
    )
    const chance = clamp(baseChance + wealthBonus + abilityChanceBonus, 0, 1)

    if (roll >= chance) continue

    const sortedProvinceIds = [...controlledProvinceIds].sort()

    let bestProvinceId: ProvinceId = sortedProvinceIds[0]!
    let bestScore = -Infinity
    for (const pid of sortedProvinceIds) {
      const p = currentCtx.state.provinces[pid]
      if (!p) continue
      const score = scoreHouseLandDevelopmentProvince(p)
      if (score > bestScore) {
        bestScore = score
        bestProvinceId = pid
      }
    }

    const targetProvince = currentCtx.state.provinces[bestProvinceId]
    if (!targetProvince) continue

    const effectiveGain =
      currentCtx.config.houseLandDevelopmentGain *
      (1 - Math.max(0, targetProvince.development) / 100)
    const newDevelopment = clamp(targetProvince.development + effectiveGain, -100, 100)

    // v0.16: houseControl 廃止により Province の control 更新は polityControl のみだが、
    // 開発による control gain は将来の代官能力経由に委ねる (Stage A では development のみ更新)。
    const newProvinces = {
      ...currentCtx.state.provinces,
      [bestProvinceId]: {
        ...targetProvince,
        development: newDevelopment,
      },
    }
    const newHouse = {
      ...house,
      wealth: house.wealth - currentCtx.config.houseLandDevelopmentBaseCost,
    }
    const newHouses = {
      ...currentCtx.state.houses,
      [houseId as HouseId]: newHouse,
    }

    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        provinces: newProvinces,
        houses: newHouses,
      },
    }

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
    const event: SimEvent = {
      id: eventId,
      year: eventCtx.state.currentYear,
      month: eventCtx.state.currentMonth,
      type: 'HOUSE_LAND_DEVELOPED',
      importance: 'minor',
      actorIds: [],
      houseIds: [houseId as HouseId],
      polityIds: [],
      provinceIds: [bestProvinceId],
      summary: `${house.name} invested in developing ${targetProvince.name}.`,
      reasons: [],
      effects: [],
    }
    currentCtx = {
      ...eventCtx,
      state: currentCtx.state,
      events: [...eventCtx.events, event],
    }
  }

  return currentCtx
}
