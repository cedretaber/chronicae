import type { TickContext } from './context'
import { makeEventId } from './context'
import { clamp } from '../utils/math'
import { randomFloat } from '../rng/rng'
import type { ProvinceId, PolityId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import type { SimEvent } from '../types/event'
import { getProvincePopulationPressure, getPopWealthByClass } from '../selectors/popSelectors'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import {
  getProvinceManpowerBase,
  getProvinceHouseManpowerBase,
} from '../selectors/popEconomySelectors'
import {
  adjustProvincePopUnrestByClass,
  adjustProvincePopUnrest,
  adjustProvincePopWealthByClass,
} from '../mutations/popMutations'
import { getAttitudeOrDefault, attitudeValueToScore } from '../helpers/attitudeHelpers'
import { adjustPolityLegacyPrestige } from '../helpers/attitudeHelpers'
import { getPolityLegitimacy, getPolityStability } from '../selectors/statusSelectors'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'
import { createRebelPolity } from '../mutations/worldStructureMutations'

// v0.16 §17: ProvinceRevoltSystem (簡略化版)
// v0.15 では concession / lordship_change / independence の 3 outcome があったが、
// v0.16 では LandContract chain の整合性を保つため independence outcome のみを実装する。
// concession / lordship_change は将来 unrest 緩和 / share 再分配などで再導入予定。

type RevoltCandidate = {
  provinceId: ProvinceId
  rebelClass: PopClass
  revoltTendency: number
}

function calcRevoltTendency(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
): number {
  const state = ctx.state
  const config = ctx.config

  const province = state.provinces[provinceId]
  if (!province) return 0

  const terminalPolityId = getProvinceTerminalPolityId(state, provinceId)
  if (!terminalPolityId) return 0
  const polity = state.polities[terminalPolityId]
  if (!polity) return 0

  const ownerHouseId = getProvinceEffectiveOwnerHouseId(state, provinceId)
  if (!ownerHouseId) return 0
  const ownerHouse = state.houses[ownerHouseId]
  if (!ownerHouse) return 0

  const pop = (() => {
    for (const popId of province.popGroupIds) {
      const p = state.popGroups[popId]
      if (p && p.class === rebelClass) return p
    }
    return undefined
  })()
  if (!pop) return 0

  // v0.16: houseControl は廃止。lowHouseControl 因子は polityControl で代用 (係数は流用)
  let tendency =
    pop.unrest * config.provinceRevoltUnrestFactor +
    (100 - province.polityControl) * config.provinceRevoltLowHouseControlFactor +
    (100 - province.polityControl) * config.provinceRevoltLowCountryControlFactor -
    getPolityStability(state, config, terminalPolityId) *
      config.provinceRevoltStabilitySuppressionFactor

  if (rebelClass === 'peasants') {
    if (pop.wealth < config.povertyWealthThreshold) {
      tendency += (config.povertyWealthThreshold - pop.wealth) * config.peasantRevoltPovertyFactor
    }
    tendency +=
      getProvincePopulationPressure(state, config, provinceId) * config.peasantRevoltPressureFactor
  } else if (rebelClass === 'townsmen') {
    const townsmenWealth = getPopWealthByClass(state, provinceId, 'townsmen')
    if (townsmenWealth < config.overExtractionWealthSafeThreshold) {
      tendency += config.townsmenRevoltExtractionFactor
      tendency +=
        Math.log1p(getProvinceProduction(state, config, provinceId)) *
        config.townsmenRevoltProductionFactor
    }
  } else if (rebelClass === 'nobles') {
    const a_house = getAttitudeOrDefault(state, pop, { kind: 'house', id: ownerHouseId })
    const a_polity = getAttitudeOrDefault(state, pop, { kind: 'polity', id: terminalPolityId })
    const houseScore =
      attitudeValueToScore(a_house.affection) * 0.6 + attitudeValueToScore(a_house.respect) * 0.4
    const polityScore =
      attitudeValueToScore(a_polity.affection) * 0.6 + attitudeValueToScore(a_polity.respect) * 0.4
    const nobleDisloyalty = 100 - (0.5 * houseScore + 0.5 * polityScore)
    tendency += nobleDisloyalty * config.nobleRevoltHouseDisloyaltyFactor
    tendency +=
      (100 - getPolityLegitimacy(state, terminalPolityId)) * config.nobleRevoltLowLegitimacyFactor
  }

  return tendency
}

function collectCandidates(ctx: TickContext): RevoltCandidate[] {
  const candidates: RevoltCandidate[] = []
  const config = ctx.config

  for (const provinceIdStr of Object.keys(ctx.state.provinces).sort()) {
    const provinceId = provinceIdStr as ProvinceId
    const province = ctx.state.provinces[provinceId]
    if (!province) continue
    const terminalPolityId = getProvinceTerminalPolityId(ctx.state, provinceId)
    if (!terminalPolityId) continue
    const polity = ctx.state.polities[terminalPolityId]
    if (!polity || !polity.active) continue
    const ownerHouseId = getProvinceEffectiveOwnerHouseId(ctx.state, provinceId)
    if (!ownerHouseId) continue
    const ownerHouse = ctx.state.houses[ownerHouseId]
    if (!ownerHouse || !ownerHouse.active) continue

    const classes: PopClass[] = ['peasants', 'townsmen', 'nobles']
    let bestClass: PopClass | undefined
    let bestTendency = -Infinity

    for (const cls of classes) {
      const tendency = calcRevoltTendency(ctx, provinceId, cls)
      if (tendency > bestTendency) {
        bestTendency = tendency
        bestClass = cls
      }
    }

    if (bestClass === undefined || bestTendency < config.provinceRevoltThreshold) continue

    candidates.push({
      provinceId,
      rebelClass: bestClass,
      revoltTendency: bestTendency,
    })
  }

  return candidates
}

function resolveRevolt(ctx: TickContext, candidate: RevoltCandidate): TickContext {
  const { provinceId, rebelClass, revoltTendency } = candidate
  const config = ctx.config

  const province = ctx.state.provinces[provinceId]
  if (!province) return ctx
  const terminalPolityId = getProvinceTerminalPolityId(ctx.state, provinceId)
  if (!terminalPolityId) return ctx
  const polity = ctx.state.polities[terminalPolityId]
  if (!polity || !polity.active) return ctx
  const ownerHouseId = getProvinceEffectiveOwnerHouseId(ctx.state, provinceId)
  if (!ownerHouseId) return ctx

  const revoltChance = clamp(
    revoltTendency / config.provinceRevoltChanceDivisor,
    0,
    config.provinceRevoltMaxChance,
  )

  const { value: roll1, rng: rng1 } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: rng1 }
  if (roll1 >= revoltChance) return ctx

  // PROVINCE_REVOLT_STARTED
  const { id: startEventId, ctx: ctxStart } = makeEventId(ctx)
  const startEvent: SimEvent = {
    id: startEventId,
    year: ctxStart.state.currentYear,
    month: ctxStart.state.currentMonth,
    type: 'PROVINCE_REVOLT_STARTED',
    importance: 'normal',
    actorIds: [],
    houseIds: [ownerHouseId],
    polityIds: [terminalPolityId],
    provinceIds: [provinceId],
    summary: `A ${rebelClass} revolt has started in ${province.name}!`,
    reasons: [],
    effects: [],
  }
  ctx = { ...ctxStart, events: [...ctxStart.events, startEvent] }

  // Revolt power & suppression power
  const pop = (() => {
    for (const popId of province.popGroupIds) {
      const p = ctx.state.popGroups[popId]
      if (p && p.class === rebelClass) return p
    }
    return undefined
  })()
  if (!pop) return ctx

  const popRevoltPower =
    pop.size * config.popRevoltPowerFactorByClass[rebelClass] * (0.5 + pop.unrest / 100)

  const ownerHousePower =
    getProvinceHouseManpowerBase(ctx.state, config, provinceId) *
    config.provinceRevoltHouseSuppressionFactor
  const polityPower =
    getProvinceManpowerBase(ctx.state, config, provinceId) *
    config.provinceRevoltCountrySuppressionFactor
  const ownerHouse = ctx.state.houses[ownerHouseId]
  let suppressionPower = ownerHousePower + polityPower
  suppressionPower += Math.log1p(polity.treasury) * config.provinceRevoltTreasurySuppressionFactor
  if (ownerHouse) {
    suppressionPower +=
      Math.log1p(ownerHouse.wealth) * config.provinceRevoltHouseWealthSuppressionFactor
  }

  const successChance = popRevoltPower / (popRevoltPower + suppressionPower + 1)
  const { value: successRoll, rng: rng2 } = randomFloat(ctx.rng)
  ctx = { ...ctx, rng: rng2 }

  if (successRoll >= successChance) {
    return resolveRevoltFailure(ctx, provinceId, rebelClass, terminalPolityId)
  }

  // Success: independence outcome only (v0.16 簡略化)
  return resolveRevoltIndependence(ctx, provinceId, rebelClass, terminalPolityId)
}

function resolveRevoltFailure(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
  polityId: PolityId,
): TickContext {
  const config = ctx.config

  let newState = adjustProvincePopUnrestByClass(
    ctx.state,
    provinceId,
    rebelClass,
    -config.provinceRevoltFailedUnrestReduction,
  )

  const province = newState.provinces[provinceId]
  if (province) {
    newState = {
      ...newState,
      provinces: {
        ...newState.provinces,
        [provinceId]: {
          ...province,
          development: clamp(
            province.development - config.provinceRevoltFailedDevastation,
            -100,
            100,
          ),
        },
      },
    }
  }

  newState = adjustProvincePopWealthByClass(
    newState,
    provinceId,
    rebelClass,
    -config.provinceRevoltFailedWealthPenalty,
  )

  newState = adjustProvincePopUnrest(
    newState,
    provinceId,
    config.provinceRevoltSuppressionCollateralUnrestGain,
  )

  newState = adjustPolityLegacyPrestige(newState, polityId, 1)

  ctx = { ...ctx, state: newState }

  const { id: failEventId, ctx: ctxFail } = makeEventId(ctx)
  const failEvent: SimEvent = {
    id: failEventId,
    year: ctxFail.state.currentYear,
    month: ctxFail.state.currentMonth,
    type: 'PROVINCE_REVOLT_FAILED',
    importance: 'normal',
    actorIds: [],
    houseIds: [],
    polityIds: [polityId],
    provinceIds: [provinceId],
    summary: `The ${rebelClass} revolt in ${ctxFail.state.provinces[provinceId]?.name ?? provinceId} has been suppressed.`,
    reasons: [],
    effects: [],
  }
  return { ...ctxFail, events: [...ctxFail.events, failEvent] }
}

function resolveRevoltIndependence(
  ctx: TickContext,
  provinceId: ProvinceId,
  rebelClass: PopClass,
  oldPolityId: PolityId,
): TickContext {
  // Use existing createRebelPolity to do the atomic creation
  const result = createRebelPolity(ctx, { provinceId, rebelClass, oldPolityId })
  if (!result.ok) return ctx
  let nextCtx = result.value.ctx

  const province = nextCtx.state.provinces[provinceId]
  if (province) {
    const newState = {
      ...nextCtx.state,
      provinces: {
        ...nextCtx.state.provinces,
        [provinceId]: {
          ...province,
          polityControl: ctx.config.provinceRevoltNewCountryControl,
        },
      },
    }
    nextCtx = { ...nextCtx, state: newState }
  }

  // Reset rebel POP unrest
  const unrestReducedState = adjustProvincePopUnrestByClass(
    nextCtx.state,
    provinceId,
    rebelClass,
    -50,
  )
  nextCtx = { ...nextCtx, state: unrestReducedState }

  // PROVINCE_REVOLT_SUCCEEDED event
  const { id: succEventId, ctx: ctxSucc } = makeEventId(nextCtx)
  const succEvent: SimEvent = {
    id: succEventId,
    year: ctxSucc.state.currentYear,
    month: ctxSucc.state.currentMonth,
    type: 'PROVINCE_REVOLT_SUCCEEDED',
    importance: 'critical',
    actorIds: [result.value.value.personId],
    houseIds: [],
    polityIds: [result.value.value.polityId, oldPolityId],
    provinceIds: [provinceId],
    summary: `The ${rebelClass} revolt in ${ctxSucc.state.provinces[provinceId]?.name ?? provinceId} has succeeded — a new polity is born!`,
    reasons: [],
    effects: [],
  }
  return { ...ctxSucc, events: [...ctxSucc.events, succEvent] }
}

export function runProvinceRevoltSystem(ctx: TickContext): TickContext {
  // Only run once per year (in January) — full simulation is monthly which can be too noisy
  if (ctx.state.currentMonth !== 1) return ctx

  const candidates = collectCandidates(ctx).sort((a, b) => b.revoltTendency - a.revoltTendency)
  // Limit to top 3 per year to avoid mass chaos
  const limit = Math.min(3, candidates.length)

  let currentCtx = ctx
  for (let i = 0; i < limit; i++) {
    const c = candidates[i]
    if (!c) break
    currentCtx = resolveRevolt(currentCtx, c)
  }
  return currentCtx
}
