import type { TickContext } from './context'
import { createSimEvent } from './context'
import { randomFloat } from '../rng/rng'
import { clamp } from '../utils/math'
import type { PolityId, HouseId, ProvinceId } from '../types/ids'
import { nameParam, entityRef } from '../types/event'
import { calcTreasurerDevelopmentCostModifier } from '../selectors/personAbilityEffects'
import { getPolityLeaderHouse } from '../selectors/officeSelectors'
import type { WorldState } from '../types/world'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
  getProvinceHoldings,
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

    const holdings = getProvinceHoldings(currentCtx.state, bestProvinceId)
    if (holdings.length === 0) continue
    const targetHolding = holdings.reduce((best, h) =>
      h.development < best.development ? h : best,
    )

    const newDevelopment = clamp(
      targetHolding.development + ctx.config.polityLandDevelopmentGain,
      -100,
      100,
    )
    const newHoldings = {
      ...currentCtx.state.holdings,
      [targetHolding.id]: { ...targetHolding, development: newDevelopment },
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
        polities: { ...currentCtx.state.polities, [polityId as PolityId]: updatedPolity },
      },
    }

    const { event, ctx: eventCtx } = createSimEvent(currentCtx, {
      type: 'POP_LAND_DEVELOPED',
      importance: 'normal',
      messageKey: 'polity.land_developed',
      messageParams: {
        polity: nameParam('polity', polity.nameKey, polity.name),
        province: nameParam('province', targetProvince.nameKey, targetProvince.name),
      },
      entityRefs: [
        entityRef('polity', polityId, 'polity', polity.nameKey),
        entityRef('province', bestProvinceId, 'province', targetProvince.nameKey),
      ],
      legacySummary: `${polity.name} invested in land development in ${targetProvince.name}.`,
      legacyPolityIds: [polityId as PolityId],
      legacyProvinceIds: [bestProvinceId],
    })
    currentCtx = {
      ...eventCtx,
      state: currentCtx.state,
      events: [...eventCtx.events, event],
    }
  }

  return currentCtx
}
