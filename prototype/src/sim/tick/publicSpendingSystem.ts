import type { TickContext } from './context'
import { makeEventId } from './context'
import { randomFloat } from '../rng/rng'
import { clamp, clamp100 } from '../utils/math'
import type { CountryId, HouseId, ProvinceId } from '../types/ids'
import type { Province } from '../types/province'
import type { SimEvent } from '../types/event'
import {
  calcChancellorMonumentScoreBonus,
  calcChancellorLandDevelopmentScoreBonus,
  calcTreasurerDevelopmentCostModifier,
} from '../selectors/personAbilityEffects'
import { getCountryLegitimacy, getCountryStability } from '../selectors/statusSelectors'
import {
  getCountryRulerHouse,
  getHouseLeader,
  getActiveOfficeHolders,
} from '../selectors/officeSelectors'
import {
  adjustCountryLegacyPrestige,
  adjustHouseLegacyPrestige,
  getAttitudeOrDefault,
  attitudeValueToScore,
} from '../helpers/attitudeHelpers'
import { getRoleScore } from '../selectors/abilitySelectors'

function scoreLandDevelopmentProvince(province: Province, rulerHouseId: HouseId): number {
  const recoveryBonus = Math.max(0, -province.development) * 1.0
  const rulerHouseProvinceBonus = province.ownerHouseId === rulerHouseId ? 15 : 0
  return recoveryBonus + rulerHouseProvinceBonus
}

export function runPublicSpendingSystem(ctx: TickContext): TickContext {
  if (!ctx.config.publicSpendingEnabled) return ctx
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  for (const countryId of Object.keys(ctx.state.countries).sort()) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country || !country.active) continue

    const rulerHouseId = getCountryRulerHouse(currentCtx.state, countryId as CountryId)
    if (!rulerHouseId) continue
    const rulerHouse = currentCtx.state.houses[rulerHouseId]
    if (!rulerHouse) continue

    const rulerHeadId = getHouseLeader(currentCtx.state, rulerHouseId)
    if (!rulerHeadId) continue
    const rulerHead = currentCtx.state.persons[rulerHeadId]
    if (!rulerHead || !rulerHead.alive) continue

    const countryRef = { kind: 'country' as const, id: countryId as CountryId }
    const administratorId = getActiveOfficeHolders(currentCtx.state, countryRef, 'administrator')[0]
    const treasurerId = getActiveOfficeHolders(currentCtx.state, countryRef, 'treasurer')[0]
    const administratorAdmin = administratorId
      ? getRoleScore(currentCtx.state, administratorId, 'governance') / 10
      : 0
    const treasurerAdmin = treasurerId
      ? getRoleScore(currentCtx.state, treasurerId, 'stewardship') / 10
      : 0

    const treasurySurplus = Math.max(0, country.treasury - ctx.config.monumentBaseCost)
    const treasuryShortage = Math.max(
      0,
      ctx.config.countryLandDevelopmentBaseCost - country.treasury,
    )

    const monumentScore =
      (100 - getCountryLegitimacy(currentCtx.state, countryId as CountryId)) * 0.3 +
      rulerHead.traits.ambition * 30 +
      rulerHouse.legacyPrestige * 0.1 +
      treasurySurplus -
      rulerHead.traits.caution * 25 +
      treasurerAdmin * 2 +
      calcChancellorMonumentScoreBonus(currentCtx.state, countryId as CountryId, currentCtx.config)

    const headCountryAtt = getAttitudeOrDefault(currentCtx.state, rulerHead, {
      kind: 'country',
      id: countryId as CountryId,
    })
    const headCountryLoyalty =
      (attitudeValueToScore(headCountryAtt.affection) * 0.55 +
        attitudeValueToScore(headCountryAtt.respect) * 0.45) /
      100

    const landDevelopmentScore =
      (100 - getCountryStability(currentCtx.state, currentCtx.config, countryId as CountryId)) *
        0.4 +
      headCountryLoyalty * 20 +
      rulerHead.traits.caution * 10 -
      treasuryShortage +
      administratorAdmin * 2 +
      calcChancellorLandDevelopmentScoreBonus(
        currentCtx.state,
        countryId as CountryId,
        currentCtx.config,
      )

    const { value: roll, rng: nextRng } = randomFloat(currentCtx.rng)
    currentCtx = { ...currentCtx, rng: nextRng }

    if (roll >= ctx.config.publicSpendingYearlyChance) continue

    const currentState = currentCtx.state

    if (monumentScore > landDevelopmentScore) {
      if (country.treasury < ctx.config.monumentBaseCost) continue

      const qualifyingProvinceIds = Object.keys(currentCtx.state.provinces).filter((pid) => {
        const p = currentCtx.state.provinces[pid as ProvinceId]
        return p?.countryId === countryId && p.countryControl > 0 && p.countryControl < 100
      }) as ProvinceId[]

      if (qualifyingProvinceIds.length === 0) continue

      let bestProvinceId: ProvinceId = qualifyingProvinceIds[0]!
      let bestScore = -Infinity
      for (const pid of qualifyingProvinceIds) {
        const p = currentCtx.state.provinces[pid]
        if (!p) continue
        const score = (100 - p.countryControl) * 1.0 + p.development * 0.5
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
          countryControl: clamp100(
            targetProvince.countryControl + ctx.config.monumentCountryControlGain,
          ),
        },
      }

      const updatedCountry = {
        ...country,
        treasury: country.treasury - ctx.config.monumentBaseCost,
      }

      let monumentState = {
        ...currentState,
        provinces: newProvinces,
        countries: { ...currentCtx.state.countries, [countryId as CountryId]: updatedCountry },
      }
      monumentState = adjustCountryLegacyPrestige(monumentState, countryId as CountryId, 3)
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
        countryIds: [countryId as CountryId],
        provinceIds: [bestProvinceId],
        summary: `${country.name} built a great monument.`,
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
        countryId as CountryId,
        currentCtx.config,
      )
      const effectiveCost = Math.max(
        1,
        Math.round(ctx.config.countryLandDevelopmentBaseCost * costModifier),
      )
      if (country.treasury < effectiveCost) continue

      const sortedProvinceIds = Object.keys(currentCtx.state.provinces)
        .filter((pid) => {
          const p = currentCtx.state.provinces[pid as ProvinceId]
          return p?.countryId === countryId
        })
        .sort() as ProvinceId[]

      if (sortedProvinceIds.length === 0) continue

      let bestProvinceId: ProvinceId = sortedProvinceIds[0]!
      let bestScore = -Infinity
      for (const pid of sortedProvinceIds) {
        const p = currentCtx.state.provinces[pid]
        if (!p) continue
        const score = scoreLandDevelopmentProvince(p, rulerHouseId)
        if (score > bestScore) {
          bestScore = score
          bestProvinceId = pid
        }
      }

      const targetProvince = currentCtx.state.provinces[bestProvinceId]
      if (!targetProvince) continue

      const newDevelopment = clamp(
        targetProvince.development + ctx.config.countryLandDevelopmentGain,
        -100,
        100,
      )
      const newHouseControl = clamp100(
        targetProvince.houseControl + ctx.config.landDevelopmentHouseControlGain,
      )
      const newProvinces = {
        ...currentCtx.state.provinces,
        [bestProvinceId]: {
          ...targetProvince,
          development: newDevelopment,
          houseControl: newHouseControl,
        },
      }

      const updatedCountry = {
        ...country,
        treasury: country.treasury - effectiveCost,
      }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentState,
          provinces: newProvinces,
          countries: { ...currentCtx.state.countries, [countryId as CountryId]: updatedCountry },
        },
      }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'COUNTRY_LAND_DEVELOPED',
        importance: 'normal',
        actorIds: [],
        houseIds: [],
        countryIds: [countryId as CountryId],
        provinceIds: [bestProvinceId],
        summary: `${country.name} invested in land development in ${targetProvince.name}.`,
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
