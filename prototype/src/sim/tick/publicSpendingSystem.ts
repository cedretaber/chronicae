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

function scoreLandDevelopmentProvince(province: Province, rulerHouseId: HouseId): number {
  const recoveryBonus = Math.max(0, -province.development) * 1.0
  const highValueBonus = province.baseTax * 4 + province.manpower * 2
  const rulerHouseProvinceBonus = province.ownerHouseId === rulerHouseId ? 15 : 0
  const unrestPenalty = province.unrest * 0.4
  return recoveryBonus + highValueBonus + rulerHouseProvinceBonus - unrestPenalty
}

export function runPublicSpendingSystem(ctx: TickContext): TickContext {
  if (!ctx.config.publicSpendingEnabled) return ctx
  if (ctx.state.currentMonth !== 1) return ctx

  let currentCtx = ctx

  for (const countryId of Object.keys(ctx.state.countries).sort()) {
    const country = currentCtx.state.countries[countryId as CountryId]
    if (!country || !country.active) continue

    const rulerHouse = currentCtx.state.houses[country.rulerHouseId]
    if (!rulerHouse) continue

    const rulerHead = currentCtx.state.persons[rulerHouse.headId]
    if (!rulerHead || !rulerHead.alive) continue

    const chancellorId = country.roleAssignments.chancellor
    const treasurerId = country.roleAssignments.treasurer
    const chancellorAdmin = chancellorId
      ? (currentCtx.state.persons[chancellorId]?.stats.admin ?? 0)
      : 0
    const treasurerAdmin = treasurerId
      ? (currentCtx.state.persons[treasurerId]?.stats.admin ?? 0)
      : 0

    const countryProvinces = Object.values(currentCtx.state.provinces).filter(
      (p) => p.countryId === countryId,
    )
    const avgUnrest =
      countryProvinces.length > 0
        ? countryProvinces.reduce((sum, p) => sum + p.unrest, 0) / countryProvinces.length
        : 0

    const treasurySurplus = Math.max(0, country.treasury - ctx.config.monumentBaseCost)
    const treasuryShortage = Math.max(
      0,
      ctx.config.countryLandDevelopmentBaseCost - country.treasury,
    )

    const monumentScore =
      (100 - country.legitimacy) * 0.3 +
      rulerHead.traits.ambition * 30 +
      rulerHouse.prestige * 0.1 +
      treasurySurplus -
      rulerHead.traits.caution * 25 +
      treasurerAdmin * 2 +
      calcChancellorMonumentScoreBonus(currentCtx.state, country, currentCtx.config)

    const landDevelopmentScore =
      (100 - country.stability) * 0.4 +
      avgUnrest * 0.5 +
      rulerHead.traits.loyaltyToCountry * 20 +
      rulerHead.traits.caution * 10 -
      treasuryShortage +
      chancellorAdmin * 2 +
      calcChancellorLandDevelopmentScoreBonus(currentCtx.state, country, currentCtx.config)

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
        const score = (100 - p.countryControl) * 1.0 + p.development * 0.5 - p.unrest * 0.5
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
        legitimacy: clamp100(country.legitimacy + ctx.config.monumentLegitimacyGain),
      }

      const currentHouse = currentCtx.state.houses[country.rulerHouseId]
      if (!currentHouse) continue
      const updatedHouse = { ...currentHouse, prestige: clamp100(currentHouse.prestige + 2) }

      currentCtx = {
        ...currentCtx,
        state: {
          ...currentState,
          provinces: newProvinces,
          countries: { ...currentCtx.state.countries, [countryId]: updatedCountry },
          houses: { ...currentCtx.state.houses, [country.rulerHouseId]: updatedHouse },
        },
      }

      const { id: eventId, ctx: eventCtx } = makeEventId(currentCtx)
      const event: SimEvent = {
        id: eventId,
        year: eventCtx.state.currentYear,
        month: eventCtx.state.currentMonth,
        type: 'MONUMENT_BUILT',
        importance: 'major',
        actorIds: [],
        houseIds: [country.rulerHouseId],
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
        country,
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
        const score = scoreLandDevelopmentProvince(p, country.rulerHouseId)
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
      const newUnrest = Math.max(
        0,
        targetProvince.unrest - ctx.config.landDevelopmentUnrestReduction,
      )
      const newProvinces = {
        ...currentCtx.state.provinces,
        [bestProvinceId]: {
          ...targetProvince,
          development: newDevelopment,
          houseControl: newHouseControl,
          unrest: newUnrest,
        },
      }

      const updatedCountry = {
        ...country,
        treasury: country.treasury - effectiveCost,
        stability: clamp100(country.stability + 2),
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
