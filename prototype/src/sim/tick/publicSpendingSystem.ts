import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import type { PolityId, HouseId, ProvinceId } from '../types/ids'
import type { SimEvent } from '../types/event'
import { calcTreasurerDevelopmentCostModifier } from '../selectors/personAbilityEffects'
import { getPolityLeaderHouse } from '../selectors/officeSelectors'
import type { WorldState } from '../types/world'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
  getProvincePrimaryHolding,
  getProvinceDevelopmentFromHoldings,
} from '../selectors/landContractSelectors'

function scoreLandDevelopmentProvince(
  state: WorldState,
  provinceId: ProvinceId,
  rulerHouseId: HouseId,
): number {
  const dev = getProvinceDevelopmentFromHoldings(state, provinceId)
  const recoveryBonus = Math.max(0, -dev) * 1.0
  const effectiveOwner = getProvinceEffectiveOwnerHouseId(state, provinceId)
  const rulerHouseProvinceBonus = effectiveOwner === rulerHouseId ? 15 : 0
  return recoveryBonus + rulerHouseProvinceBonus
}

export function runPublicSpendingSystem(ctx: TickContext): TickContext {
  if (!ctx.config.publicSpendingEnabled) return ctx

  let currentCtx = ctx

  for (const polityId of Object.keys(ctx.state.polities).sort()) {
    const polity = ctx.state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue

    const rulerHouseId = getPolityLeaderHouse(currentCtx.state, polityId as PolityId)
    if (!rulerHouseId) continue

    const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }
    if (roll >= ctx.config.publicSpendingYearlyChance) continue

    const costModifier = calcTreasurerDevelopmentCostModifier(
      currentCtx.state,
      polityId as PolityId,
      currentCtx.config,
    )
    const effectiveCost = Math.max(
      1,
      Math.round(ctx.config.polityLandDevelopmentBaseCost * costModifier),
    )
    if (polity.treasury < effectiveCost) continue

    const sortedProvinceIds = Object.keys(currentCtx.state.provinces)
      .filter(
        (pid) => getProvinceTerminalPolityId(currentCtx.state, pid as ProvinceId) === polityId,
      )
      .sort() as ProvinceId[]
    if (sortedProvinceIds.length === 0) continue

    let bestProvinceId: ProvinceId = sortedProvinceIds[0]!
    let bestScore = -Infinity
    for (const pid of sortedProvinceIds) {
      const score = scoreLandDevelopmentProvince(currentCtx.state, pid, rulerHouseId)
      if (score > bestScore) {
        bestScore = score
        bestProvinceId = pid
      }
    }

    const targetProvince = currentCtx.state.provinces[bestProvinceId]
    if (!targetProvince) continue

    const primaryHolding = getProvincePrimaryHolding(currentCtx.state, bestProvinceId)
    if (!primaryHolding) continue

    const newDevelopment = clamp(
      primaryHolding.development + ctx.config.polityLandDevelopmentGain,
      -100,
      100,
    )
    const newHoldings = {
      ...currentCtx.state.holdings,
      [primaryHolding.id]: { ...primaryHolding, development: newDevelopment },
    }
    const newProvinces = {
      ...currentCtx.state.provinces,
      [bestProvinceId]: { ...targetProvince, development: newDevelopment },
    }
    const updatedPolity = {
      ...polity,
      treasury: polity.treasury - effectiveCost,
    }

    currentCtx = {
      ...currentCtx,
      state: {
        ...currentCtx.state,
        holdings: newHoldings,
        provinces: newProvinces,
        polities: { ...currentCtx.state.polities, [polityId as PolityId]: updatedPolity },
      },
    }

    const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
    const event: SimEvent = {
      id: eventId,
      year: eventCtx.state.currentYear,
      weekOfYear: eventCtx.state.currentWeekOfYear,
      type: 'POP_LAND_DEVELOPED',
      importance: 'normal',
      actorIds: [],
      houseIds: [],
      polityIds: [polityId as PolityId],
      provinceIds: [bestProvinceId],
      holdingIds: [],
      summary: `${polity.name} invested in land development in ${targetProvince.name}.`,
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
