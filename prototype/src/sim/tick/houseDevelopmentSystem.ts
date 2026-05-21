import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import { calcHouseHeadDevelopmentChanceBonus } from '../selectors/personAbilityEffects'
import type { HouseId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'
import {
  getHouseControlledProvinceIds,
  getProvinceDevelopmentFromHoldings,
  getProvinceHoldings,
} from '../selectors/landContractSelectors'
import type { WorldState } from '../types/world'

function scoreHouseLandDevelopmentProvince(state: WorldState, provinceId: ProvinceId): number {
  const dev = getProvinceDevelopmentFromHoldings(state, provinceId)
  const recoveryBonus = Math.max(0, -dev) * 1.0
  const developmentPotentialBonus = (100 - Math.max(0, dev)) * 0.3
  return recoveryBonus + developmentPotentialBonus
}

export function runHouseDevelopmentSystem(ctx: TickContext): TickContext {
  if (!ctx.config.houseDevelopmentEnabled) return ctx

  let currentCtx = ctx

  for (const houseId of Object.keys(ctx.state.houses).sort()) {
    const house = currentCtx.state.houses[houseId as HouseId]
    if (!house || !house.active) continue
    if (house.kind === 'system') continue
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
      const score = scoreHouseLandDevelopmentProvince(currentCtx.state, pid)
      if (score > bestScore) {
        bestScore = score
        bestProvinceId = pid
      }
    }

    const targetProvince = currentCtx.state.provinces[bestProvinceId]
    if (!targetProvince) continue

    const holdings = getProvinceHoldings(currentCtx.state, bestProvinceId)
    if (holdings.length === 0) continue
    const targetHolding = holdings.reduce((best, h) =>
      h.development < best.development ? h : best,
    )

    const effectiveGain =
      currentCtx.config.houseLandDevelopmentGain *
      (1 - Math.max(0, targetHolding.development) / 100)
    const newDevelopment = clamp(targetHolding.development + effectiveGain, -100, 100)

    const newHoldings = {
      ...currentCtx.state.holdings,
      [targetHolding.id]: { ...targetHolding, development: newDevelopment },
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
        holdings: newHoldings,
        houses: newHouses,
      },
    }

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
    const event: SimEvent = {
      id: eventId,
      year: eventCtx.state.currentYear,
      weekOfYear: eventCtx.state.currentWeekOfYear,
      type: 'HOUSE_LAND_DEVELOPED',
      importance: 'minor',
      actorIds: [],
      houseIds: [houseId as HouseId],
      polityIds: [],
      provinceIds: [bestProvinceId],
      holdingIds: [],
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
