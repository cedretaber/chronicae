import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp, clamp100 } from '../utils/math'
import type { PolityId, HouseId, ProvinceId } from '../types/ids'
import type { Province } from '../types/province'
import type { SimEvent } from '../types/event'
import {
  calcChancellorMonumentScoreBonus,
  calcChancellorLandDevelopmentScoreBonus,
  calcTreasurerDevelopmentCostModifier,
} from '../selectors/personAbilityEffects'
import { getPolityLegitimacy, getPolityStability } from '../selectors/statusSelectors'
import {
  getPolityLeaderHouse,
  getHouseLeader,
  getActiveOfficeHolders,
} from '../selectors/officeSelectors'
import {
  adjustPolityLegacyPrestige,
  adjustHouseLegacyPrestige,
  getAttitudeOrDefault,
  attitudeValueToScore,
} from '../helpers/attitudeHelpers'
import { getRoleScore } from '../selectors/abilitySelectors'
import type { WorldState } from '../types/world'
import {
  getProvinceTerminalPolityId,
  getProvinceEffectiveOwnerHouseId,
} from '../selectors/landContractSelectors'

function scoreLandDevelopmentProvince(
  state: WorldState,
  province: Province,
  rulerHouseId: HouseId,
): number {
  const recoveryBonus = Math.max(0, -province.development) * 1.0
  const effectiveOwner = getProvinceEffectiveOwnerHouseId(state, province.id)
  const rulerHouseProvinceBonus = effectiveOwner === rulerHouseId ? 15 : 0
  return recoveryBonus + rulerHouseProvinceBonus
}

export function runPublicSpendingSystem(ctx: TickContext): TickContext {
  if (!ctx.config.publicSpendingEnabled) return ctx
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  for (const polityId of Object.keys(ctx.state.polities).sort()) {
    const polity = ctx.state.polities[polityId as PolityId]
    if (!polity || !polity.active) continue

    const rulerHouseId = getPolityLeaderHouse(currentCtx.state, polityId as PolityId)
    if (!rulerHouseId) continue
    const rulerHouse = currentCtx.state.houses[rulerHouseId]
    if (!rulerHouse) continue

    const rulerHeadId = getHouseLeader(currentCtx.state, rulerHouseId)
    if (!rulerHeadId) continue
    const rulerHead = currentCtx.state.persons[rulerHeadId]
    if (!rulerHead || !rulerHead.alive) continue

    const polityRef = { kind: 'polity' as const, id: polityId as PolityId }
    const administratorId = getActiveOfficeHolders(currentCtx.state, polityRef, 'administrator')[0]
    const treasurerId = getActiveOfficeHolders(currentCtx.state, polityRef, 'treasurer')[0]
    const administratorAdmin = administratorId
      ? getRoleScore(currentCtx.state, administratorId, 'governance') / 10
      : 0
    const treasurerAdmin = treasurerId
      ? getRoleScore(currentCtx.state, treasurerId, 'stewardship') / 10
      : 0

    const treasurySurplus = Math.max(0, polity.treasury - ctx.config.monumentBaseCost)
    const treasuryShortage = Math.max(0, ctx.config.polityLandDevelopmentBaseCost - polity.treasury)

    const monumentScore =
      (100 - getPolityLegitimacy(currentCtx.state, polityId as PolityId)) * 0.3 +
      rulerHead.traits.ambition * 30 +
      rulerHouse.legacyPrestige * 0.1 +
      treasurySurplus -
      rulerHead.traits.caution * 25 +
      treasurerAdmin * 2 +
      calcChancellorMonumentScoreBonus(currentCtx.state, polityId as PolityId, currentCtx.config)

    const headPolityAtt = getAttitudeOrDefault(currentCtx.state, rulerHead, {
      kind: 'polity',
      id: polityId as PolityId,
    })
    const headPolityLoyalty =
      (attitudeValueToScore(headPolityAtt.affection) * 0.55 +
        attitudeValueToScore(headPolityAtt.respect) * 0.45) /
      100

    const landDevelopmentScore =
      (100 - getPolityStability(currentCtx.state, currentCtx.config, polityId as PolityId)) * 0.4 +
      headPolityLoyalty * 20 +
      rulerHead.traits.caution * 10 -
      treasuryShortage +
      administratorAdmin * 2 +
      calcChancellorLandDevelopmentScoreBonus(
        currentCtx.state,
        polityId as PolityId,
        currentCtx.config,
      )

    const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    if (roll >= ctx.config.publicSpendingYearlyChance) continue

    const currentState = currentCtx.state

    if (monumentScore > landDevelopmentScore) {
      if (polity.treasury < ctx.config.monumentBaseCost) continue

      const qualifyingProvinceIds = Object.keys(currentCtx.state.provinces).filter((pid) => {
        const p = currentCtx.state.provinces[pid as ProvinceId]
        if (!p) return false
        if (getProvinceTerminalPolityId(currentCtx.state, pid as ProvinceId) !== polityId)
          return false
        return p.polityControl > 0 && p.polityControl < 100
      }) as ProvinceId[]

      if (qualifyingProvinceIds.length === 0) continue

      let bestProvinceId: ProvinceId = qualifyingProvinceIds[0]!
      let bestScore = -Infinity
      for (const pid of qualifyingProvinceIds) {
        const p = currentCtx.state.provinces[pid]
        if (!p) continue
        const score = (100 - p.polityControl) * 1.0 + p.development * 0.5
        if (score > bestScore) {
          bestScore = score
          bestProvinceId = pid
        }
      }

      const targetProvince = currentCtx.state.provinces[bestProvinceId]
      if (!targetProvince) continue

      const newProvinces = {
        ...currentCtx.state.provinces,
        [bestProvinceId]: {
          ...targetProvince,
          polityControl: clamp100(
            targetProvince.polityControl + ctx.config.monumentPolityControlGain,
          ),
        },
      }

      const updatedPolity = {
        ...polity,
        treasury: polity.treasury - ctx.config.monumentBaseCost,
      }

      let monumentState = {
        ...currentState,
        provinces: newProvinces,
        polities: { ...currentCtx.state.polities, [polityId as PolityId]: updatedPolity },
      }
      monumentState = adjustPolityLegacyPrestige(monumentState, polityId as PolityId, 3)
      monumentState = adjustHouseLegacyPrestige(monumentState, rulerHouseId, 2)
      currentCtx = { ...currentCtx, state: monumentState }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'MONUMENT_BUILT',
        importance: 'major',
        actorIds: [],
        houseIds: [rulerHouseId],
        polityIds: [polityId as PolityId],
        provinceIds: [bestProvinceId],
        summary: `${polity.name} built a great monument.`,
        reasons: [],
        effects: [],
      }
      currentCtx = {
        ...eventCtx,
        state: currentCtx.state,
        events: [...eventCtx.events, event],
      }
    } else {
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
        const p = currentCtx.state.provinces[pid]
        if (!p) continue
        const score = scoreLandDevelopmentProvince(currentCtx.state, p, rulerHouseId)
        if (score > bestScore) {
          bestScore = score
          bestProvinceId = pid
        }
      }

      const targetProvince = currentCtx.state.provinces[bestProvinceId]
      if (!targetProvince) continue

      const newDevelopment = clamp(
        targetProvince.development + ctx.config.polityLandDevelopmentGain,
        -100,
        100,
      )
      // v0.16: houseControl 廃止により Province の control 更新は development のみ。
      const newProvinces = {
        ...currentCtx.state.provinces,
        [bestProvinceId]: {
          ...targetProvince,
          development: newDevelopment,
        },
      }

      const updatedPolity = {
        ...polity,
        treasury: polity.treasury - effectiveCost,
      }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentState,
          provinces: newProvinces,
          polities: { ...currentCtx.state.polities, [polityId as PolityId]: updatedPolity },
        },
      }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'POP_LAND_DEVELOPED',
        importance: 'normal',
        actorIds: [],
        houseIds: [],
        polityIds: [polityId as PolityId],
        provinceIds: [bestProvinceId],
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
  }

  return currentCtx
}
