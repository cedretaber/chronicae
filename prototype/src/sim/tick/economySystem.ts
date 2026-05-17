import type { TickContext } from './context'
import type { ProvinceId, HouseId, CountryId } from '../types/ids'
import type { PopClass } from '../types/popGroup'
import { calcTreasurerTaxEfficiency } from '../selectors/personAbilityEffects'
import { getProvinceProduction } from '../selectors/popEconomySelectors'
import { getProvinceAveragePopWealth, getProvinceUnrest } from '../selectors/popSelectors'
import {
  adjustProvincePopWealth,
  adjustProvincePopUnrest,
  adjustProvincePopWealthByClass,
} from '../mutations/popMutations'

export function runEconomySystem(ctx: TickContext): TickContext {
  const wealthDeltas = new Map<HouseId, number>()
  const treasuryDeltas = new Map<CountryId, number>()

  let currentState = ctx.state

  for (const provinceId of Object.keys(ctx.state.provinces).sort()) {
    const province = ctx.state.provinces[provinceId as ProvinceId]
    if (!province) continue

    const production = getProvinceProduction(ctx.state, ctx.config, province.id)
    const cc = province.countryControl / 100
    const hc = province.houseControl / 100
    const totalControl = cc + hc

    let countryIncome: number
    let houseIncome: number

    if (totalControl > 0) {
      countryIncome = production * (cc / totalControl) * cc
      houseIncome = production * (hc / totalControl) * hc
    } else {
      countryIncome = 0
      houseIncome = 0
    }

    const extracted = countryIncome + houseIncome
    const retained = Math.max(0, production - extracted)

    // Apply taxEfficiency to country treasury
    treasuryDeltas.set(
      province.countryId,
      (treasuryDeltas.get(province.countryId) ?? 0) + countryIncome,
    )

    // Apply house income
    wealthDeltas.set(
      province.ownerHouseId,
      (wealthDeltas.get(province.ownerHouseId) ?? 0) + houseIncome,
    )

    // Apply retained wealth to POPs
    const retainedRatio = production > 0 ? retained / production : 0
    const retainedWealthGainByClass = ctx.config.retainedWealthGainByClass
    const popClasses: PopClass[] = ['peasants', 'townsmen', 'nobles']

    for (const popClass of popClasses) {
      const delta = retainedRatio * retainedWealthGainByClass[popClass]
      currentState = adjustProvincePopWealthByClass(currentState, province.id, popClass, delta)
    }

    // Over-extraction penalty
    const extractionRatio = production > 0 ? extracted / production : 0
    const overExtractionThreshold = ctx.config.overExtractionThreshold
    const overExtractionWealthSafeThreshold = ctx.config.overExtractionWealthSafeThreshold
    const overExtractionUnrestSafeThreshold = ctx.config.overExtractionUnrestSafeThreshold
    const overExtractionWealthPenalty = ctx.config.overExtractionWealthPenalty
    const overExtractionUnrestGain = ctx.config.overExtractionUnrestGain

    if (extractionRatio > overExtractionThreshold) {
      const averageWealth = getProvinceAveragePopWealth(ctx.state, province.id)
      const provinceUnrest = getProvinceUnrest(ctx.state, province.id)

      if (
        averageWealth < overExtractionWealthSafeThreshold ||
        provinceUnrest > overExtractionUnrestSafeThreshold
      ) {
        const over = extractionRatio - overExtractionThreshold
        currentState = adjustProvincePopWealth(
          currentState,
          province.id,
          -over * overExtractionWealthPenalty,
        )
        currentState = adjustProvincePopUnrest(
          currentState,
          province.id,
          over * overExtractionUnrestGain,
        )
      }
    }
  }

  // v013-residual: simple-batch — delta map 集約後の単一バッチ書き込み。将来 adjustHouseWealth() 等で代替可だが delta 集約パターンが有用なので直接記述
  const newHouses = { ...currentState.houses }
  for (const houseId of Object.keys(currentState.houses).sort()) {
    const house = newHouses[houseId as HouseId]
    if (!house) continue
    const delta = wealthDeltas.get(houseId as HouseId) ?? 0
    newHouses[houseId as HouseId] = {
      ...house,
      wealth: Math.max(0, house.wealth + delta),
    }
  }

  // v013-residual: simple-batch — taxEfficiency を乗じた treasury バッチ更新。上記と同様
  const newCountries = { ...currentState.countries }
  for (const countryId of Object.keys(currentState.countries).sort()) {
    const country = newCountries[countryId as CountryId]
    if (!country) continue
    if (!country.active) continue
    const taxEfficiency = calcTreasurerTaxEfficiency(ctx.state, country.id, ctx.config)
    const delta = treasuryDeltas.get(countryId as CountryId) ?? 0
    newCountries[countryId as CountryId] = {
      ...country,
      treasury: country.treasury + delta * taxEfficiency,
    }
  }

  return {
    ...ctx,
    state: {
      ...currentState,
      houses: newHouses,
      countries: newCountries,
    },
  }
}
